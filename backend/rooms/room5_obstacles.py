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
OBSTACLE_COLLISION_RADIUS = 0.35
VELOCITY_NORM = 10.0

ACTIONS9 = [(tx, ty) for tx in (-1, 0, 1) for ty in (-1, 0, 1)]


class Room5Obstacles(BaseRoom):
    """The Storm room (bonus): DQN over continuous physics with drifting obstacles
    and a partial, nearest-K observation of obstacle positions within a visibility
    radius. After training, a generalization test runs the trained greedy policy
    on fresh, never-trained-on obstacle layouts.
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

    # ---------- environment setup ----------

    def state_dim(self):
        return 4 + 2 * self.k_visible

    def make_obstacles(self):
        obstacles = []
        for _ in range(self.n_obstacles):
            x = random.uniform(2.0, 8.0)
            y = random.uniform(2.0, 8.0)
            while math.hypot(x - START[0], y - START[1]) < 1.2 or math.hypot(x - EXIT_CENTER[0], y - EXIT_CENTER[1]) < 1.2:
                x = random.uniform(2.0, 8.0)
                y = random.uniform(2.0, 8.0)
            angle = random.uniform(0, 2 * math.pi)
            dvx = math.cos(angle) * self.obstacle_drift
            dvy = math.sin(angle) * self.obstacle_drift
            obstacles.append([x, y, dvx, dvy])
        return obstacles

    def step_obstacles(self, obstacles):
        new_obstacles = []
        for x, y, dvx, dvy in obstacles:
            nx, ny = x + dvx * DT, y + dvy * DT
            if nx < 0.5 or nx > 9.5:
                dvx = -dvx
                nx = min(9.5, max(0.5, nx))
            if ny < 0.5 or ny > 9.5:
                dvy = -dvy
                ny = min(9.5, max(0.5, ny))
            new_obstacles.append([nx, ny, dvx, dvy])
        return new_obstacles

    def reset(self):
        dim = self.state_dim()
        self.online = DQNNetwork(state_dim=dim)
        self.target = DQNNetwork(state_dim=dim)
        self.target.load_state_dict(self.online.state_dict())
        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=self.lr)
        self.buffer = ReplayBuffer(self.buffer_size)
        self.preview_obstacles = self.make_obstacles()
        self.state = (START[0], START[1], 0.0, 0.0)
        self.stop_requested = False
        self.paused = False
        return self.state

    def configure(self, params: dict):
        self.lr = params.get("learning_rate", self.lr)
        self.gamma = params.get("gamma", self.gamma)
        self.epsilon_start = params.get("epsilon", self.epsilon_start)
        self.epsilon_min = params.get("epsilon_min", self.epsilon_min)
        self.epsilon_decay = params.get("epsilon_decay", self.epsilon_decay)
        self.batch_size = params.get("batch_size", self.batch_size)
        self.buffer_size = params.get("buffer_size", self.buffer_size)
        self.target_sync = params.get("target_sync", self.target_sync)
        self.episodes = params.get("episodes", self.episodes)
        self.max_steps = params.get("max_steps", self.max_steps)
        self.drag = params.get("drag", self.drag)
        self.n_obstacles = params.get("N_obstacles", self.n_obstacles)
        self.visibility_range = params.get("visibility_range", self.visibility_range)
        self.k_visible = params.get("K_visible", self.k_visible)
        self.obstacle_drift = params.get("obstacle_drift", self.obstacle_drift)

    def map_info(self):
        return {
            "start": list(START),
            "exit_center": list(EXIT_CENTER),
            "exit_radius": EXIT_RADIUS,
            "size": SIZE,
            "obstacles": [[o[0], o[1]] for o in self.preview_obstacles],
        }

    # ---------- physics + partial observation ----------

    def physics_step(self, state, action_idx, obstacles):
        x, y, vx, vy = state
        tx, ty = ACTIONS9[action_idx]
        vx = vx * self.drag + tx
        vy = vy * self.drag + ty
        nx = x + vx * DT
        ny = y + vy * DT

        hit_wall = nx < 0 or nx > SIZE or ny < 0 or ny > SIZE
        nx = min(SIZE, max(0.0, nx))
        ny = min(SIZE, max(0.0, ny))
        if hit_wall:
            vx, vy = 0.0, 0.0

        # Potential-based shaping (distance-to-exit delta): without it the agent
        # tends to converge to a "freeze in place" local optimum, since with
        # obstacles in play the only signal otherwise is the uniform step
        # penalty plus rare, risky +-terminal rewards. This telescopes to zero
        # over an episode, so it doesn't change the optimal policy.
        dist_before = math.hypot(x - EXIT_CENTER[0], y - EXIT_CENTER[1])
        dist_after = math.hypot(nx - EXIT_CENTER[0], ny - EXIT_CENTER[1])
        shaping = 8.0 * (dist_before - dist_after)

        for ox, oy, _, _ in obstacles:
            if math.hypot(nx - ox, ny - oy) <= OBSTACLE_COLLISION_RADIUS:
                return (nx, ny, vx, vy), -20.0 + shaping, True

        if dist_after <= EXIT_RADIUS:
            return (nx, ny, vx, vy), 100.0 + shaping, True
        if hit_wall:
            return (nx, ny, vx, vy), -10.0 + shaping, False
        return (nx, ny, vx, vy), -0.05 + shaping, False

    def obstacle_features(self, x, y, obstacles):
        ranked = sorted(obstacles, key=lambda o: math.hypot(o[0] - x, o[1] - y))
        feats = []
        vis = self.visibility_range
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

    def normalize_state(self, x, y, vx, vy, obstacles):
        base = [(x / SIZE) * 2 - 1, (y / SIZE) * 2 - 1, vx / VELOCITY_NORM, vy / VELOCITY_NORM]
        return base + self.obstacle_features(x, y, obstacles)

    # ---------- DQN ----------

    def epsilon_greedy(self, state_norm, epsilon):
        if np.random.random() < epsilon:
            return np.random.randint(9)
        with torch.no_grad():
            q = self.online(torch.tensor(state_norm, dtype=torch.float32).unsqueeze(0))
        return int(torch.argmax(q, dim=1).item())

    def train_step(self):
        states, actions, rewards, next_states, dones = self.buffer.sample(self.batch_size)
        states_t = torch.from_numpy(states)
        actions_t = torch.from_numpy(actions)
        rewards_t = torch.from_numpy(rewards)
        next_states_t = torch.from_numpy(next_states)
        dones_t = torch.from_numpy(dones)

        q_values = self.online(states_t).gather(1, actions_t.unsqueeze(1)).squeeze(1)
        with torch.no_grad():
            next_q = self.target(next_states_t).max(dim=1)[0]
            target_q = rewards_t + self.gamma * next_q * (1 - dones_t)

        loss = nn.functional.mse_loss(q_values, target_q)
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()
        return loss.item()

    @staticmethod
    async def _safe_send(websocket, payload):
        """Send, returning False instead of raising if the client is gone.

        A disconnect during a long training run only flips stop_requested,
        which this loop only notices at its next check - in between, a send
        on the now-dead socket would otherwise raise (WebSocketDisconnect,
        or a plain RuntimeError from Starlette depending on exactly when the
        close happens) and crash this background task with no one to catch
        it.
        """
        try:
            await websocket.send_json(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            return False

    async def train(self, params: dict, websocket):
        self.configure(params)
        dim = self.state_dim()
        self.online = DQNNetwork(state_dim=dim)
        self.target = DQNNetwork(state_dim=dim)
        self.target.load_state_dict(self.online.state_dict())
        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=self.lr)
        self.buffer = ReplayBuffer(self.buffer_size)
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
            obstacles = self.make_obstacles()
            trajectory = [{"pos": [state[0], state[1]], "reward": 0.0, "obstacles": [[o[0], o[1]] for o in obstacles]}]
            total_reward = 0.0
            step = 0

            for step in range(self.max_steps):
                obstacles = self.step_obstacles(obstacles)
                state_norm = self.normalize_state(*state, obstacles)
                action = self.epsilon_greedy(state_norm, epsilon)
                next_state, reward, done = self.physics_step(state, action, obstacles)
                next_norm = self.normalize_state(*next_state, obstacles)
                self.buffer.push(state_norm, action, reward, next_norm, done)

                loss_val = None
                if len(self.buffer) >= self.batch_size:
                    loss_val = self.train_step()
                    global_step += 1
                    if global_step % self.target_sync == 0:
                        self.target.load_state_dict(self.online.state_dict())

                state = next_state
                trajectory.append({
                    "pos": [state[0], state[1]],
                    "reward": reward,
                    "obstacles": [[o[0], o[1]] for o in obstacles],
                })
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
                        "buffer_capacity": self.buffer_size,
                        "done": done,
                    }):
                        disconnected = True
                        break
                if done:
                    break

            self.save_episode(episode, trajectory)
            episode_rewards[episode] = total_reward
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

    # ---------- generalization test ----------

    async def test_generalization(self, websocket, num_layouts=10):
        runs = []
        for _ in range(num_layouts):
            obstacles = self.make_obstacles()
            state = (START[0], START[1], 0.0, 0.0)
            total_reward = 0.0
            success = False
            step = 0
            for step in range(self.max_steps):
                obstacles = self.step_obstacles(obstacles)
                state_norm = self.normalize_state(*state, obstacles)
                action = self.epsilon_greedy(state_norm, 0.0)
                state, reward, done = self.physics_step(state, action, obstacles)
                total_reward += reward
                if done:
                    # Reward shaping means the exit reward isn't exactly 100.0,
                    # so check the actual terminal position instead.
                    dist_to_exit = math.hypot(state[0] - EXIT_CENTER[0], state[1] - EXIT_CENTER[1])
                    success = dist_to_exit <= EXIT_RADIUS
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
        obstacles = self.step_obstacles(self.preview_obstacles)
        self.preview_obstacles = obstacles
        next_state, reward, done = self.physics_step(self.state, action, obstacles)
        self.state = next_state
        return next_state, reward, done
