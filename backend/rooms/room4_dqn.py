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
DT = 0.02        # simulation timestep — player decides direction every 0.02 s (per spec)
SPEED = 50.0     # units/second; at max speed: 50 * 0.02 = 1 unit per step
WIND_MAX = 0.6   # max wind drift in units/step (60% of max agent speed)

ACTIONS9 = [(tx, ty) for tx in (-1, 0, 1) for ty in (-1, 0, 1)]

STATE_DIM = 6    # (x, y, vx, vy, wind_x_norm, wind_y_norm)


def normalize_state(x, y, vx, vy, wind_x=0.0, wind_y=0.0):
    """Normalise to [-1,1]. Wind components are already in [-WIND_MAX, WIND_MAX]."""
    wx = wind_x / WIND_MAX if WIND_MAX > 0 else 0.0
    wy = wind_y / WIND_MAX if WIND_MAX > 0 else 0.0
    return [(x / SIZE) * 2 - 1, (y / SIZE) * 2 - 1, float(vx), float(vy), wx, wy]


class Room4DQN(BaseRoom):
    """Deep Trench room: continuous physics with wind drift, navigated via DQN."""

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
        self.max_steps = 200
        self.exit_reward = 100.0
        self.wall_penalty = -10.0
        self.step_penalty = -0.05
        self.wind_strength = 0.4   # fraction of WIND_MAX; 0 = no wind

        self.wind_x = 0.0
        self.wind_y = 0.0
        self.state = (START[0], START[1], 0.0, 0.0)
        self.reset()

    def reset(self):
        self.online = DQNNetwork(state_dim=STATE_DIM)
        self.target = DQNNetwork(state_dim=STATE_DIM)
        self.target.load_state_dict(self.online.state_dict())
        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=self.lr)
        self.buffer = ReplayBuffer(self.buffer_size)
        self.state = (START[0], START[1], 0.0, 0.0)
        self.wind_x = 0.0
        self.wind_y = 0.0
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
        self.exit_reward = params.get("exit_reward", self.exit_reward)
        self.wall_penalty = params.get("wall_penalty", self.wall_penalty)
        self.step_penalty = params.get("step_penalty", self.step_penalty)
        self.wind_strength = params.get("wind_strength", self.wind_strength)

    def _new_wind(self):
        """Random wind vector for this episode, magnitude in [0, wind_strength * WIND_MAX]."""
        if self.wind_strength <= 0:
            return 0.0, 0.0
        angle = random.uniform(0, 2 * math.pi)
        mag = random.uniform(0.3, 1.0) * self.wind_strength * WIND_MAX
        return mag * math.cos(angle), mag * math.sin(angle)

    def map_info(self):
        return {
            "start": list(START),
            "exit_center": list(EXIT_CENTER),
            "exit_radius": EXIT_RADIUS,
            "size": SIZE,
            "wind": [self.wind_x, self.wind_y],
        }

    def physics_step(self, state, action_idx, wind_x=0.0, wind_y=0.0):
        x, y, _vx, _vy = state
        tx, ty = ACTIONS9[action_idx]
        vx, vy = float(tx), float(ty)
        # Wind drifts position; agent must compensate by choosing opposite direction.
        nx = x + (vx + wind_x) * SPEED * DT
        ny = y + (vy + wind_y) * SPEED * DT

        hit_wall = nx < 0 or nx > SIZE or ny < 0 or ny > SIZE
        nx = min(SIZE, max(0.0, nx))
        ny = min(SIZE, max(0.0, ny))

        dist = math.hypot(nx - EXIT_CENTER[0], ny - EXIT_CENTER[1])
        if dist <= EXIT_RADIUS:
            return (nx, ny, vx, vy), self.exit_reward, True
        if hit_wall:
            return (nx, ny, 0, 0), self.wall_penalty, False
        return (nx, ny, vx, vy), self.step_penalty, False

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

    async def train(self, params: dict, websocket):
        self.configure(params)
        self.online = DQNNetwork(state_dim=STATE_DIM)
        self.target = DQNNetwork(state_dim=STATE_DIM)
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

            # New random wind for every episode — agent must learn to compensate
            wind_x, wind_y = self._new_wind()
            self.wind_x, self.wind_y = wind_x, wind_y

            state = (START[0], START[1], 0.0, 0.0)
            trajectory = [{"pos": [state[0], state[1]], "reward": 0.0,
                           "wind": [wind_x, wind_y]}]
            total_reward = 0.0
            step = 0

            for step in range(self.max_steps):
                state_norm = normalize_state(*state, wind_x, wind_y)
                action = self.epsilon_greedy(state_norm, epsilon)
                next_state, reward, done = self.physics_step(state, action, wind_x, wind_y)
                next_norm = normalize_state(*next_state, wind_x, wind_y)
                self.buffer.push(state_norm, action, reward, next_norm, done)

                loss_val = None
                if len(self.buffer) >= self.batch_size:
                    loss_val = self.train_step()
                    global_step += 1
                    if global_step % self.target_sync == 0:
                        self.target.load_state_dict(self.online.state_dict())

                state = next_state
                trajectory.append({"pos": [state[0], state[1]], "reward": reward,
                                    "wind": [wind_x, wind_y]})
                total_reward += reward

                if step % 5 == 0:
                    if not await self._safe_send(websocket, {
                        "type": "step_update",
                        "episode": episode,
                        "step": step,
                        "agent_pos": [state[0], state[1]],
                        "velocity": [state[2], state[3]],
                        "wind": [wind_x, wind_y],
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
