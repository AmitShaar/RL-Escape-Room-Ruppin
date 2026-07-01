import asyncio
import math
import random

import numpy as np
import torch
import torch.nn as nn
from starlette.websockets import WebSocketDisconnect

from .base_room import BaseRoom
from models.dqn_network import DQNNetwork
from replay_buffer import ReplayBuffer

torch.set_num_threads(1)

SIZE = 10.0
START = (1.0, 1.0)
EXIT_CENTER = (9.0, 9.0)
EXIT_RADIUS = 0.5
DT = 0.02
OBSTACLE_RADIUS = 0.25          # diameter = 0.5 m, matching spec
VELOCITY_NORM = 10.0

ACTIONS9 = [(tx, ty) for tx in (-1, 0, 1) for ty in (-1, 0, 1)]


class Room5Storm(BaseRoom):
    """The Storm — DQN over continuous physics with drifting obstacles.

    State = (x, y, vx, vy, dx_1, dy_1, ..., dx_K, dy_K): base physics state
    plus the relative offset to each of the K nearest obstacles within
    visibility_range metres. Out-of-range obstacles get a "not visible"
    sentinel, keeping the input dimension fixed regardless of how many
    obstacles are actually near.

    After training, test_generalization() evaluates the greedy policy on
    fresh, never-trained-on obstacle layouts.
    """

    def __init__(self):
        super().__init__()
        self.lr = 1e-3
        self.gamma = 0.99
        self.epsilon_start = 1.0
        self.epsilon_min = 0.01
        self.epsilon_decay = 0.995
        self.batch_size = 64
        self.buffer_size = 10000
        self.target_sync = 100
        self.episodes = 300
        self.max_steps = 500
        self.drag = 0.85

        self.n_obstacles = 5
        self.visibility_range = 3.0
        self.k_visible = 3
        self.obstacle_drift = 0.01

        self.online = None
        self.target = None
        self.optimizer = None
        self.buffer = None
        self.preview_obstacles = []
        self.state = (START[0], START[1], 0.0, 0.0)
        self.reset()

    # ---------- environment ----------

    def state_dim(self):
        return 4 + 2 * self.k_visible

    def _build_networks(self):
        dim = self.state_dim()
        self.online = DQNNetwork(state_dim=dim)
        self.target = DQNNetwork(state_dim=dim)
        self.target.load_state_dict(self.online.state_dict())
        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=self.lr)
        self.buffer = ReplayBuffer(self.buffer_size)

    def reset(self):
        self._build_networks()
        self.preview_obstacles = self._make_obstacles()
        self.state = (START[0], START[1], 0.0, 0.0)
        self.stop_requested = False
        self.paused = False
        return self.state

    def _make_obstacles(self):
        obstacles = []
        for _ in range(self.n_obstacles):
            x = random.uniform(2.0, 8.0)
            y = random.uniform(2.0, 8.0)
            while (math.hypot(x - START[0], y - START[1]) < 1.5 or
                   math.hypot(x - EXIT_CENTER[0], y - EXIT_CENTER[1]) < 1.5):
                x = random.uniform(2.0, 8.0)
                y = random.uniform(2.0, 8.0)
            angle = random.uniform(0, 2 * math.pi)
            obstacles.append([x, y,
                               math.cos(angle) * self.obstacle_drift,
                               math.sin(angle) * self.obstacle_drift])
        return obstacles

    def _step_obstacles(self, obstacles):
        out = []
        for x, y, dvx, dvy in obstacles:
            nx, ny = x + dvx * DT, y + dvy * DT
            if nx < 0.5 or nx > 9.5:
                dvx = -dvx
                nx = max(0.5, min(9.5, nx))
            if ny < 0.5 or ny > 9.5:
                dvy = -dvy
                ny = max(0.5, min(9.5, ny))
            out.append([nx, ny, dvx, dvy])
        return out

    def configure(self, params: dict):
        self.lr = params.get("learning_rate", self.lr)
        self.gamma = params.get("gamma", self.gamma)
        self.epsilon_start = params.get("epsilon", self.epsilon_start)
        self.epsilon_decay = params.get("epsilon_decay", self.epsilon_decay)
        self.episodes = params.get("episodes", self.episodes)
        self.max_steps = params.get("max_steps", self.max_steps)
        self.n_obstacles = params.get("n_obstacles", self.n_obstacles)
        self.visibility_range = params.get("visibility_range", self.visibility_range)
        self.k_visible = params.get("k_visible", self.k_visible)
        self.obstacle_drift = params.get("obstacle_drift", self.obstacle_drift)

    def map_info(self):
        return {
            "start": list(START),
            "exit_center": list(EXIT_CENTER),
            "exit_radius": EXIT_RADIUS,
            "size": SIZE,
            "obstacles": [[o[0], o[1]] for o in self.preview_obstacles],
        }

    # ---------- physics ----------

    def _obstacle_features(self, x, y, obstacles):
        ranked = sorted(obstacles, key=lambda o: math.hypot(o[0] - x, o[1] - y))
        vis = self.visibility_range
        feats = []
        for i in range(self.k_visible):
            if i < len(ranked):
                ox, oy = ranked[i][0], ranked[i][1]
                d = math.hypot(ox - x, oy - y)
            else:
                d = None
            if d is not None and d <= vis:
                feats.extend([(ox - x) / vis, (oy - y) / vis])
            else:
                feats.extend([(vis + 1) / vis, (vis + 1) / vis])
        return feats

    def _normalize_state(self, x, y, vx, vy, obstacles):
        base = [(x / SIZE) * 2 - 1, (y / SIZE) * 2 - 1,
                vx / VELOCITY_NORM, vy / VELOCITY_NORM]
        return base + self._obstacle_features(x, y, obstacles)

    def physics_step(self, state, action_idx, obstacles):
        x, y, vx, vy = state
        tx, ty = ACTIONS9[action_idx]
        vx = vx * self.drag + tx
        vy = vy * self.drag + ty
        nx = x + vx * DT
        ny = y + vy * DT

        hit_wall = nx < 0 or nx > SIZE or ny < 0 or ny > SIZE
        nx = max(0.0, min(SIZE, nx))
        ny = max(0.0, min(SIZE, ny))
        if hit_wall:
            vx, vy = 0.0, 0.0

        dist_before = math.hypot(x - EXIT_CENTER[0], y - EXIT_CENTER[1])
        dist_after = math.hypot(nx - EXIT_CENTER[0], ny - EXIT_CENTER[1])
        shaping = 8.0 * (dist_before - dist_after)

        for ox, oy, _, _ in obstacles:
            if math.hypot(nx - ox, ny - oy) <= OBSTACLE_RADIUS:
                return (nx, ny, vx, vy), -20.0 + shaping, True

        if dist_after <= EXIT_RADIUS:
            return (nx, ny, vx, vy), 100.0 + shaping, True
        if hit_wall:
            return (nx, ny, vx, vy), -10.0 + shaping, False
        return (nx, ny, vx, vy), -0.05 + shaping, False

    # ---------- DQN ----------

    def epsilon_greedy(self, state_norm, epsilon):
        if np.random.random() < epsilon:
            return np.random.randint(9)
        with torch.no_grad():
            q = self.online(torch.tensor(state_norm, dtype=torch.float32).unsqueeze(0))
        return int(torch.argmax(q, dim=1).item())

    def train_step(self):
        states, actions, rewards, next_states, dones = self.buffer.sample(self.batch_size)
        st = torch.from_numpy(states)
        at = torch.from_numpy(actions)
        rt = torch.from_numpy(rewards)
        nst = torch.from_numpy(next_states)
        dt = torch.from_numpy(dones)

        q_values = self.online(st).gather(1, at.unsqueeze(1)).squeeze(1)
        with torch.no_grad():
            next_q = self.target(nst).max(dim=1)[0]
            target_q = rt + self.gamma * next_q * (1 - dt)

        loss = nn.functional.mse_loss(q_values, target_q)
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()
        return loss.item()

    @staticmethod
    async def _safe_send(websocket, payload):
        try:
            await websocket.send_json(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            return False

    # ---------- training ----------

    async def train(self, params: dict, websocket):
        self.configure(params)
        self._build_networks()
        self.stop_requested = False

        epsilon = self.epsilon_start
        global_step = 0
        episode_rewards = {}

        if not await self._safe_send(websocket, {"type": "room_info", **self.map_info()}):
            return

        disconnected = False
        for episode in range(self.episodes):
            if self.stop_requested or disconnected:
                break
            await self.wait_if_paused()
            if self.stop_requested:
                break

            state = (START[0], START[1], 0.0, 0.0)
            obstacles = self._make_obstacles()
            total_reward = 0.0
            step = 0

            for step in range(self.max_steps):
                obstacles = self._step_obstacles(obstacles)
                state_norm = self._normalize_state(*state, obstacles)
                action = self.epsilon_greedy(state_norm, epsilon)
                next_state, reward, done = self.physics_step(state, action, obstacles)
                next_norm = self._normalize_state(*next_state, obstacles)
                self.buffer.push(state_norm, action, reward, next_norm, done)

                loss_val = None
                if len(self.buffer) >= self.batch_size:
                    loss_val = self.train_step()
                    global_step += 1
                    if global_step % self.target_sync == 0:
                        self.target.load_state_dict(self.online.state_dict())

                state = next_state
                total_reward += reward

                if step % 5 == 0:
                    if not await self._safe_send(websocket, {
                        "type": "step_update",
                        "episode": episode,
                        "step": step,
                        "agent_pos": [state[0], state[1]],
                        "velocity": [state[2], state[3]],
                        "obstacles": [[o[0], o[1]] for o in obstacles],
                        "reward": reward,
                        "loss": loss_val,
                        "buffer_size": len(self.buffer),
                        "done": done,
                    }):
                        disconnected = True
                        break
                if done:
                    break

            episode_rewards[episode] = total_reward
            self.save_episode(episode, [{"pos": [state[0], state[1]], "reward": total_reward}])
            epsilon = max(self.epsilon_min, epsilon * self.epsilon_decay)

            if disconnected:
                break
            if not await self._safe_send(websocket, {
                "type": "episode_end",
                "episode": episode,
                "total_reward": total_reward,
                "steps": step,
                "epsilon": epsilon,
            }):
                break
            await asyncio.sleep(0)

        if disconnected:
            return

        best_episode = max(episode_rewards, key=episode_rewards.get) if episode_rewards else 0
        await self._safe_send(websocket, {
            "type": "training_complete",
            "best_episode": best_episode,
            "best_reward": episode_rewards.get(best_episode, 0.0),
            **self.map_info(),
        })

    async def test_generalization(self, websocket, num_layouts=10):
        """Run the trained greedy policy on fresh, never-trained-on layouts."""
        runs = []
        for _ in range(num_layouts):
            obstacles = self._make_obstacles()
            state = (START[0], START[1], 0.0, 0.0)
            total_reward = 0.0
            success = False
            step = 0
            for step in range(self.max_steps):
                obstacles = self._step_obstacles(obstacles)
                state_norm = self._normalize_state(*state, obstacles)
                action = self.epsilon_greedy(state_norm, 0.0)
                state, reward, done = self.physics_step(state, action, obstacles)
                total_reward += reward
                if done:
                    dist = math.hypot(state[0] - EXIT_CENTER[0], state[1] - EXIT_CENTER[1])
                    success = dist <= EXIT_RADIUS
                    break
            runs.append({"success": success, "reward": total_reward, "steps": step})

        success_rate = sum(r["success"] for r in runs) / len(runs)
        avg_reward = sum(r["reward"] for r in runs) / len(runs)
        avg_steps = sum(r["steps"] for r in runs) / len(runs)
        await self._safe_send(websocket, {
            "type": "generalization_result",
            "success_rate": success_rate,
            "avg_reward": avg_reward,
            "avg_steps": avg_steps,
            "runs": runs,
        })

    # ---------- BaseRoom interface ----------

    def step(self, action):
        next_state, reward, done = self.physics_step(
            self.state, action, self.preview_obstacles)
        self.state = next_state
        return next_state, reward, done
