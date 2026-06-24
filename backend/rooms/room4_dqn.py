import asyncio
import math

import numpy as np
import torch
import torch.nn as nn
from starlette.websockets import WebSocketDisconnect

from .base_room import BaseRoom
from models.dqn_network import DQNNetwork
from replay_buffer import ReplayBuffer

# Tiny MLP, batch 64: single-threaded avoids per-op thread-dispatch overhead
# that otherwise dominates runtime on small tensors (~1.7x faster measured).
torch.set_num_threads(1)

SIZE = 10.0
START = (1.0, 1.0)
EXIT_CENTER = (9.0, 9.0)
EXIT_RADIUS = 0.5
DT = 0.02

ACTIONS9 = [(tx, ty) for tx in (-1, 0, 1) for ty in (-1, 0, 1)]


# Velocity has no hard bound (steady-state magnitude ~= thrust / (1 - drag),
# e.g. ~6.7 at drag=0.85), so it's scaled down for stable network inputs.
VELOCITY_NORM = 10.0


def normalize_state(x, y, vx, vy):
    return [(x / SIZE) * 2 - 1, (y / SIZE) * 2 - 1, vx / VELOCITY_NORM, vy / VELOCITY_NORM]


class Room4DQN(BaseRoom):
    """Deep Trench room: continuous physics navigated via a DQN agent."""

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
        self.episodes = 100
        self.max_steps = 500
        self.drag = 0.85

        self.online = DQNNetwork()
        self.target = DQNNetwork()
        self.target.load_state_dict(self.online.state_dict())
        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=self.lr)
        self.buffer = ReplayBuffer(self.buffer_size)

        self.state = (START[0], START[1], 0.0, 0.0)
        self.reset()

    # ---------- environment setup ----------

    def reset(self):
        self.online = DQNNetwork()
        self.target = DQNNetwork()
        self.target.load_state_dict(self.online.state_dict())
        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=self.lr)
        self.buffer = ReplayBuffer(self.buffer_size)
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

    def map_info(self):
        return {"start": list(START), "exit_center": list(EXIT_CENTER), "exit_radius": EXIT_RADIUS, "size": SIZE}

    # ---------- physics (continuous, model-free) ----------

    def physics_step(self, state, action_idx):
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

        dist = math.hypot(nx - EXIT_CENTER[0], ny - EXIT_CENTER[1])
        if dist <= EXIT_RADIUS:
            return (nx, ny, vx, vy), 100.0, True
        if hit_wall:
            return (nx, ny, vx, vy), -10.0, False
        return (nx, ny, vx, vy), -0.05, False

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
        on the now-dead socket would otherwise raise (WebSocketDisconnect on
        receive, but a plain RuntimeError from Starlette on send after
        close) and crash this background task with no one to catch it.
        """
        try:
            await websocket.send_json(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            return False

    async def train(self, params: dict, websocket):
        self.configure(params)
        self.online = DQNNetwork()
        self.target = DQNNetwork()
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
            trajectory = [{"pos": [state[0], state[1]], "reward": 0.0}]
            total_reward = 0.0
            step = 0

            for step in range(self.max_steps):
                state_norm = normalize_state(*state)
                action = self.epsilon_greedy(state_norm, epsilon)
                next_state, reward, done = self.physics_step(state, action)
                next_norm = normalize_state(*next_state)
                self.buffer.push(state_norm, action, reward, next_norm, done)

                loss_val = None
                if len(self.buffer) >= self.batch_size:
                    loss_val = self.train_step()
                    global_step += 1
                    if global_step % self.target_sync == 0:
                        self.target.load_state_dict(self.online.state_dict())

                state = next_state
                trajectory.append({"pos": [state[0], state[1]], "reward": reward})
                total_reward += reward

                if step % 5 == 0:
                    if not await self._safe_send(websocket, {
                        "type": "step_update",
                        "episode": episode,
                        "step": step,
                        "agent_pos": [state[0], state[1]],
                        "velocity": [state[2], state[3]],
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

    # ---------- BaseRoom interface ----------

    def step(self, action):
        next_state, reward, done = self.physics_step(self.state, action)
        self.state = next_state
        return next_state, reward, done
