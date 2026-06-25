import asyncio
import random

import numpy as np
from starlette.websockets import WebSocketDisconnect

from .base_room import BaseRoom

ROWS, COLS = 10, 10
START = (0, 0)
EXIT = (9, 9)

ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
ACTION_NAMES = ["UP", "DOWN", "LEFT", "RIGHT"]


class Room5MC(BaseRoom):
    """The Asteroid Field: First-Visit Monte Carlo Control with epsilon-greedy.

    חיזקי must collect K bones scattered on the grid, then reach the exit.
    Unlike SARSA/Q-Learning (which update after every step), Monte Carlo
    plays the entire episode first and only then walks back through it to
    update Q-values from the actual observed returns.
    """

    def __init__(self):
        super().__init__()
        self.alpha = 0.1
        self.gamma = 0.95
        self.epsilon = 0.3
        self.epsilon_decay = 0.995
        self.epsilon_min = 0.01
        self.episodes = 500
        self.max_steps = 300
        self.k_bones = 3
        self.slip_prob = 0.1
        self.step_delay = 0.0

        self.bones = []
        self.slip_cells = set()
        self.walls = set()
        self.q_table = None
        self.returns_count = None

        self.agent_pos = START
        self.collected = 0
        self.reset()

    # ---------- environment setup ----------

    def _random_cells(self, count, excluded):
        cells = [(r, c) for r in range(ROWS) for c in range(COLS)]
        random.shuffle(cells)
        result = []
        for cell in cells:
            if len(result) >= count:
                break
            if cell not in excluded:
                result.append(cell)
        return result

    def reset(self):
        excluded = {START, EXIT}
        self.bones = self._random_cells(self.k_bones, excluded)
        excluded = excluded | set(self.bones)
        self.slip_cells = set(self._random_cells(6, excluded))
        excluded = excluded | self.slip_cells
        self.walls = set(self._random_cells(5, excluded))

        n_masks = 1 << self.k_bones
        self.q_table = np.zeros((ROWS, COLS, n_masks, 4))
        self.returns_count = np.zeros((ROWS, COLS, n_masks, 4))

        self.agent_pos = START
        self.collected = 0
        self.stop_requested = False
        self.paused = False
        return (*self.agent_pos, 0)

    def configure(self, params: dict):
        self.alpha = params.get("alpha", self.alpha)
        self.gamma = params.get("gamma", self.gamma)
        self.epsilon = params.get("epsilon", self.epsilon)
        self.epsilon_decay = params.get("epsilon_decay", self.epsilon_decay)
        self.episodes = params.get("episodes", self.episodes)
        self.max_steps = params.get("max_steps", self.max_steps)
        new_k = params.get("k_bones", self.k_bones)
        if new_k != self.k_bones:
            self.k_bones = new_k
            self.reset()
        self.slip_prob = params.get("slip_prob", self.slip_prob)
        # See the matching comment in room2_sarsa.py: Windows' default
        # asyncio timer granularity makes sub-~15ms sleeps essentially
        # no-ops, so any non-zero delay is floored to a value confirmed to
        # actually delay.
        requested_delay_ms = params.get("step_delay_ms", 0)
        self.step_delay = max(requested_delay_ms, 30) / 1000.0 if requested_delay_ms > 0 else 0.0

    def map_info(self):
        return {
            "bones": self.bones,
            "slip_cells": list(self.slip_cells),
            "walls": list(self.walls),
        }

    # ---------- dynamics ----------

    def _move(self, row, col, action_idx):
        dr, dc = ACTIONS[action_idx]
        nr, nc = row + dr, col + dc
        if nr < 0 or nr >= ROWS or nc < 0 or nc >= COLS:
            return (row, col)
        if (nr, nc) in self.walls:
            return (row, col)
        return (nr, nc)

    def env_step(self, row, col, bitmask, action_idx):
        if (row, col) in self.slip_cells and random.random() < self.slip_prob:
            action_idx = random.randint(0, 3)

        nr, nc = self._move(row, col, action_idx)

        new_mask = bitmask
        reward = -0.1
        for i, bone in enumerate(self.bones):
            if (nr, nc) == bone and not (bitmask & (1 << i)):
                new_mask = bitmask | (1 << i)
                reward += 20.0
                break

        full_mask = (1 << self.k_bones) - 1
        if (nr, nc) == EXIT and new_mask == full_mask:
            return (nr, nc, new_mask), 100.0, True

        return (nr, nc, new_mask), reward, False

    def epsilon_greedy(self, row, col, bitmask, epsilon):
        if random.random() < epsilon:
            return random.randint(0, 3)
        return int(np.argmax(self.q_table[row, col, bitmask]))

    @staticmethod
    async def _safe_send(websocket, payload):
        """Send, returning False instead of raising if the client is gone.

        A disconnect during a long training run only flips stop_requested,
        which the train() loop only notices at its next check - in between,
        a send on the now-dead socket would otherwise raise
        (WebSocketDisconnect, or a plain RuntimeError from Starlette
        depending on exactly when the close happens) and crash this
        background task with no one to catch it.
        """
        try:
            await websocket.send_json(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            return False

    # ---------- training orchestration ----------

    async def train(self, params: dict, websocket):
        self.configure(params)
        n_masks = 1 << self.k_bones
        self.q_table = np.zeros((ROWS, COLS, n_masks, 4))
        self.returns_count = np.zeros((ROWS, COLS, n_masks, 4))
        self.stop_requested = False
        epsilon = self.epsilon
        episode_rewards = {}

        if not await self._safe_send(websocket, {"type": "room_info", **self.map_info()}):
            return

        for episode in range(self.episodes):
            if self.stop_requested:
                break
            await self.wait_if_paused()
            if self.stop_requested:
                break

            # === GENERATE FULL EPISODE FIRST ===
            # This is what makes Monte Carlo different from SARSA/Q-Learning:
            # the whole trajectory plays out before any learning happens.
            row, col, bitmask = START[0], START[1], 0
            episode_steps = []
            trajectory = [{"pos": [row, col], "bitmask": bitmask, "reward": 0.0}]
            total_reward = 0.0
            done = False
            disconnected = False

            for step in range(self.max_steps):
                action = self.epsilon_greedy(row, col, bitmask, epsilon)
                (nr, nc, nb), reward, done = self.env_step(row, col, bitmask, action)

                episode_steps.append(((row, col, bitmask), action, reward))
                total_reward += reward

                if step % 5 == 0 or done:
                    if not await self._safe_send(websocket, {
                        "type": "step_update",
                        "episode": episode,
                        "step": step,
                        "agent_pos": [nr, nc],
                        "bitmask": nb,
                        "reward": reward,
                        "q_values": np.max(self.q_table[:, :, nb, :], axis=-1).tolist(),
                        "done": done,
                        "total_episodes": self.episodes,
                        "epsilon": epsilon,
                    }):
                        disconnected = True
                        break
                    if self.step_delay > 0:
                        await asyncio.sleep(self.step_delay)

                row, col, bitmask = nr, nc, nb
                trajectory.append({"pos": [row, col], "bitmask": bitmask, "reward": reward})
                if done:
                    break

            if disconnected:
                return

            self.save_episode(episode, trajectory)
            episode_rewards[episode] = total_reward

            # === NOW UPDATE Q-VALUES (Monte Carlo update) ===
            # Walk BACKWARDS through the episode accumulating the discounted
            # return G, and apply a first-visit incremental-mean update:
            # Q(s,a) += alpha * (G - Q(s,a))
            G = 0.0
            visited = set()
            for (state, action, reward) in reversed(episode_steps):
                G = reward + self.gamma * G
                sa = (state, action)
                if sa not in visited:
                    visited.add(sa)
                    s_row, s_col, s_mask = state
                    self.returns_count[s_row, s_col, s_mask, action] += 1
                    self.q_table[s_row, s_col, s_mask, action] += self.alpha * (
                        G - self.q_table[s_row, s_col, s_mask, action]
                    )

            epsilon = max(self.epsilon_min, epsilon * self.epsilon_decay)

            if not await self._safe_send(websocket, {
                "type": "episode_end",
                "episode": episode,
                "total_reward": total_reward,
                "steps": len(episode_steps),
                "epsilon": epsilon,
                "success": done,
                "outcome": "success" if done else "fail",
            }):
                return
            await asyncio.sleep(0)

        best_episode = max(episode_rewards, key=episode_rewards.get) if episode_rewards else 0
        await self._safe_send(websocket, {
            "type": "training_complete",
            "best_episode": best_episode,
            "best_reward": episode_rewards.get(best_episode, 0.0),
            "q_values": np.max(self.q_table[:, :, 0, :], axis=-1).tolist(),
            "policy": np.argmax(self.q_table[:, :, 0, :], axis=-1).tolist(),
            **self.map_info(),
        })

    # ---------- BaseRoom interface ----------

    def step(self, action):
        row, col = self.agent_pos
        (nr, nc, nb), reward, done = self.env_step(row, col, self.collected, action)
        self.agent_pos = (nr, nc)
        self.collected = nb
        return (nr, nc, nb), reward, done
