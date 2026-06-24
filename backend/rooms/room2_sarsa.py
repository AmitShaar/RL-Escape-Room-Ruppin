import asyncio
import random

import numpy as np

from .base_room import BaseRoom

ROWS, COLS = 10, 10
START = (0, 0)
EXIT = (9, 9)

ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
ACTION_NAMES = ["UP", "DOWN", "LEFT", "RIGHT"]


class Room2SARSA(BaseRoom):
    """Ocean Currents room: model-free SARSA over (row, col, beacons_visited) state."""

    def __init__(self):
        super().__init__()
        self.alpha = 0.1
        self.gamma = 0.95
        self.epsilon = 0.2
        self.epsilon_decay = 0.995
        self.episodes = 500
        self.max_steps = 300
        self.slip_prob = 0.15
        self.k_beacons = 3
        self.exit_reward = 100.0
        self.beacon_reward = 20.0
        self.trap_reward_val = -15.0
        self.step_penalty = -0.1
        self.step_delay = 0.0

        self.beacons = []
        self.slip_cells = set()
        self.traps = set()
        self.q_table = None

        self.agent_pos = START
        self.visited = 0
        self.reset()

    # ---------- environment setup ----------

    def _random_cells(self, count, excluded):
        cells = []
        all_cells = [(r, c) for r in range(ROWS) for c in range(COLS)]
        random.shuffle(all_cells)
        for cell in all_cells:
            if len(cells) >= count:
                break
            if cell in excluded or cell in cells:
                continue
            cells.append(cell)
        return cells

    def reset(self):
        excluded = {START, EXIT}
        beacon_list = self._random_cells(self.k_beacons, excluded)
        excluded = excluded | set(beacon_list)
        slip_list = self._random_cells(8, excluded)
        excluded = excluded | set(slip_list)
        trap_list = self._random_cells(4, excluded)

        self.beacons = beacon_list
        self.slip_cells = set(slip_list)
        self.traps = set(trap_list)
        self.q_table = np.zeros((ROWS, COLS, self.k_beacons + 1, 4))

        self.agent_pos = START
        self.visited = 0
        self.stop_requested = False
        self.paused = False
        return (*self.agent_pos, self.visited)

    def configure(self, params: dict):
        self.alpha = params.get("alpha", self.alpha)
        self.gamma = params.get("gamma", self.gamma)
        self.epsilon = params.get("epsilon", self.epsilon)
        self.epsilon_decay = params.get("epsilon_decay", self.epsilon_decay)
        self.episodes = params.get("episodes", self.episodes)
        self.max_steps = params.get("max_steps", self.max_steps)
        self.slip_prob = params.get("slip_prob", self.slip_prob)
        new_k = params.get("K_beacons", self.k_beacons)
        if new_k != self.k_beacons:
            self.k_beacons = new_k
            self.reset()
        self.exit_reward = params.get("exit_reward", self.exit_reward)
        self.beacon_reward = params.get("beacon_reward", self.beacon_reward)
        self.trap_reward_val = params.get("trap_reward", self.trap_reward_val)
        self.step_penalty = params.get("step_penalty", self.step_penalty)
        self.step_delay = params.get("step_delay_ms", 0) / 1000.0

    # ---------- dynamics (model-free: sampled, not exposed to the agent) ----------

    def _intended_next(self, row, col, action_idx):
        dr, dc = ACTIONS[action_idx]
        nr, nc = row + dr, col + dc
        if nr < 0 or nr >= ROWS or nc < 0 or nc >= COLS:
            return (row, col)
        return (nr, nc)

    def env_step(self, row, col, visited, action_idx):
        if (row, col) in self.slip_cells and random.random() < self.slip_prob:
            action_idx = random.choice([a for a in range(4) if a != action_idx])
        nxt = self._intended_next(row, col, action_idx)

        if nxt in self.traps:
            return (START[0], START[1], visited), self.trap_reward_val, False
        if nxt == EXIT:
            if visited >= self.k_beacons:
                return (EXIT[0], EXIT[1], visited), self.exit_reward, True
            return (nxt[0], nxt[1], visited), self.step_penalty, False
        if visited < self.k_beacons and nxt == self.beacons[visited]:
            return (nxt[0], nxt[1], visited + 1), self.beacon_reward, False
        if nxt in self.beacons:
            return (nxt[0], nxt[1], visited), 0.0, False
        return (nxt[0], nxt[1], visited), self.step_penalty, False

    def epsilon_greedy(self, row, col, visited, epsilon):
        if random.random() < epsilon:
            return random.randrange(4)
        return int(np.argmax(self.q_table[row, col, visited]))

    # ---------- SARSA training ----------

    def map_info(self):
        return {"beacons": self.beacons, "slip_cells": list(self.slip_cells), "traps": list(self.traps)}

    async def train(self, params: dict, websocket):
        self.configure(params)
        self.q_table = np.zeros((ROWS, COLS, self.k_beacons + 1, 4))
        self.stop_requested = False
        epsilon = self.epsilon
        await websocket.send_json({"type": "room_info", **self.map_info()})

        for episode in range(self.episodes):
            if self.stop_requested:
                break
            await self.wait_if_paused()
            if self.stop_requested:
                break

            row, col, visited = START[0], START[1], 0
            action = self.epsilon_greedy(row, col, visited, epsilon)
            trajectory = [{"pos": [row, col], "reward": 0.0, "visited": visited, "action": ACTION_NAMES[action]}]
            total_reward = 0.0
            step = 0

            for step in range(self.max_steps):
                (nr, nc, nv), reward, done = self.env_step(row, col, visited, action)
                next_action = self.epsilon_greedy(nr, nc, nv, epsilon)

                td_target = reward if done else reward + self.gamma * self.q_table[nr, nc, nv, next_action]
                self.q_table[row, col, visited, action] += self.alpha * (
                    td_target - self.q_table[row, col, visited, action]
                )

                row, col, visited, action = nr, nc, nv, next_action
                trajectory.append({
                    "pos": [row, col],
                    "reward": reward,
                    "visited": visited,
                    "action": ACTION_NAMES[action] if not done else None,
                })
                total_reward += reward

                if step % 5 == 0:
                    await websocket.send_json({
                        "type": "step_update",
                        "episode": episode,
                        "step": step,
                        "agent_pos": [row, col],
                        "reward": reward,
                        "q_values": np.max(self.q_table[:, :, visited, :], axis=-1).tolist(),
                        "done": done,
                        "total_episodes": self.episodes,
                        "epsilon": epsilon,
                    })
                    if self.step_delay > 0:
                        await asyncio.sleep(self.step_delay)
                if done:
                    break

            self.save_episode(episode, trajectory)
            epsilon = max(0.01, epsilon * self.epsilon_decay)

            await websocket.send_json({
                "type": "episode_end",
                "episode": episode,
                "total_reward": total_reward,
                "steps": step,
                "outcome": "success" if done else "fail",
                "epsilon": epsilon,
            })
            await asyncio.sleep(0)

        best_episode = max(self.episode_history, key=lambda e: sum(s["reward"] for s in self.episode_history[e]))
        await websocket.send_json({
            "type": "training_complete",
            "best_episode": best_episode,
            "best_reward": sum(s["reward"] for s in self.episode_history[best_episode]),
            "policy": np.argmax(self.q_table[:, :, 0, :], axis=-1).tolist(),
            "q_values": np.max(self.q_table[:, :, 0, :], axis=-1).tolist(),
            **self.map_info(),
        })

    # ---------- BaseRoom interface ----------

    def step(self, action):
        row, col = self.agent_pos
        (nr, nc, nv), reward, done = self.env_step(row, col, self.visited, action)
        self.agent_pos = (nr, nc)
        self.visited = nv
        return (nr, nc, nv), reward, done
