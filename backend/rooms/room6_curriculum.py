import asyncio
import random

import numpy as np
from starlette.websockets import WebSocketDisconnect

from .base_room import BaseRoom

ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
ACTION_NAMES = ["UP", "DOWN", "LEFT", "RIGHT"]

STAGES = [
    {"size": 4, "label": "Stage 1: 4×4", "episodes": 100, "slip": 0.0},
    {"size": 6, "label": "Stage 2: 6×6", "episodes": 150, "slip": 0.1},
    {"size": 10, "label": "Stage 3: 10×10", "episodes": 250, "slip": 0.15},
]


class Room6Curriculum(BaseRoom):
    """The Growing Maze — Curriculum Learning.

    חיזקי starts on a small 4×4 grid, masters it, then the grid grows to
    6×6 and finally 10×10. The Q-table is transferred (not reset) between
    stages, demonstrating that skills learned on an easy problem can give
    a head start on a harder one. Algorithm: Q-Learning at each stage.
    """

    def __init__(self):
        super().__init__()
        self.alpha = 0.1
        self.gamma = 0.95
        self.epsilon = 0.3
        self.epsilon_decay = 0.99
        self.step_delay = 0.0
        self.current_stage = 0
        self.size = STAGES[0]["size"]
        self.q_table = None
        self.walls = set()
        self.start = (0, 0)
        self.exit = (self.size - 1, self.size - 1)
        self.agent_pos = self.start
        self.reset()

    def reset(self):
        self.current_stage = 0
        self.size = STAGES[0]["size"]
        self._init_stage(0)
        self.stop_requested = False
        self.paused = False

    def _init_stage(self, stage_idx):
        self.current_stage = stage_idx
        s = STAGES[stage_idx]
        self.size = s["size"]
        self.start = (0, 0)
        self.exit = (self.size - 1, self.size - 1)
        all_cells = [(r, c) for r in range(self.size) for c in range(self.size)]
        n_walls = max(0, int(len(all_cells) * 0.1))
        excluded = {self.start, self.exit}
        candidates = [c for c in all_cells if c not in excluded]
        self.walls = set(random.sample(candidates, min(n_walls, len(candidates))))
        self.q_table = np.zeros((self.size, self.size, 4))
        self.agent_pos = self.start

    def _transfer_q_table(self, old_size, new_size, old_q):
        new_q = np.zeros((new_size, new_size, 4))
        overlap = min(old_size, new_size)
        new_q[:overlap, :overlap] = old_q[:overlap, :overlap]
        return new_q

    def configure(self, params: dict):
        self.alpha = params.get("alpha", self.alpha)
        self.gamma = params.get("gamma", self.gamma)
        self.epsilon = params.get("epsilon", self.epsilon)
        # See the matching comment in room2_sarsa.py: Windows' default
        # asyncio timer granularity makes sub-~15ms sleeps essentially
        # no-ops, so any non-zero delay is floored to a value confirmed to
        # actually delay.
        requested_delay_ms = params.get("step_delay_ms", 0)
        self.step_delay = max(requested_delay_ms, 30) / 1000.0 if requested_delay_ms > 0 else 0.0

    def map_info(self):
        return {
            "size": self.size,
            "stage": self.current_stage,
            "stage_label": STAGES[self.current_stage]["label"],
            "start": list(self.start),
            "exit": list(self.exit),
            "walls": list(self.walls),
        }

    def _move(self, row, col, action_idx):
        dr, dc = ACTIONS[action_idx]
        nr, nc = row + dr, col + dc
        if nr < 0 or nr >= self.size or nc < 0 or nc >= self.size:
            return row, col
        if (nr, nc) in self.walls:
            return row, col
        return nr, nc

    def env_step(self, row, col, action_idx, slip_prob):
        if random.random() < slip_prob:
            action_idx = random.randint(0, 3)
        nr, nc = self._move(row, col, action_idx)
        if (nr, nc) == self.exit:
            return nr, nc, 100.0, True
        return nr, nc, -0.1, False

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

    async def _run_stage(self, stage_idx, websocket, epsilon):
        s = STAGES[stage_idx]
        old_size = self.size
        old_q = self.q_table

        self._init_stage(stage_idx)

        if stage_idx > 0:
            self.q_table = self._transfer_q_table(old_size, self.size, old_q)

        if not await self._safe_send(websocket, {
            "type": "stage_start",
            "stage": stage_idx,
            "stage_label": s["label"],
            "size": self.size,
            **self.map_info(),
        }):
            return epsilon, True

        for episode in range(s["episodes"]):
            if self.stop_requested:
                return epsilon, False
            await self.wait_if_paused()
            if self.stop_requested:
                return epsilon, False

            row, col = self.start
            total_reward = 0.0
            trajectory = [{"pos": [row, col], "reward": 0.0}]
            done = False
            step = 0

            for step in range(200):
                if random.random() < epsilon:
                    action = random.randint(0, 3)
                else:
                    action = int(np.argmax(self.q_table[row, col]))

                nr, nc, reward, done = self.env_step(row, col, action, s["slip"])

                best_next = np.max(self.q_table[nr, nc])
                self.q_table[row, col, action] += self.alpha * (
                    reward + self.gamma * best_next - self.q_table[row, col, action]
                )

                row, col = nr, nc
                self.agent_pos = (row, col)
                total_reward += reward
                trajectory.append({"pos": [row, col], "reward": reward})

                if step % 5 == 0 or done:
                    if not await self._safe_send(websocket, {
                        "type": "step_update",
                        "stage": stage_idx,
                        "episode": episode,
                        "step": step,
                        "agent_pos": [row, col],
                        "q_values": np.max(self.q_table, axis=-1).tolist(),
                        "done": done,
                    }):
                        return epsilon, True
                    if self.step_delay > 0:
                        await asyncio.sleep(self.step_delay)

                if done:
                    break

            global_episode = sum(STAGES[i]["episodes"] for i in range(stage_idx)) + episode
            self.save_episode(global_episode, trajectory)
            epsilon = max(0.01, epsilon * self.epsilon_decay)

            if not await self._safe_send(websocket, {
                "type": "episode_end",
                "stage": stage_idx,
                "stage_label": s["label"],
                "episode": episode,
                "global_episode": global_episode,
                "total_reward": total_reward,
                "epsilon": epsilon,
                "success": done,
                "outcome": "success" if done else "fail",
            }):
                return epsilon, True
            await asyncio.sleep(0)

        return epsilon, False

    async def train(self, params: dict, websocket):
        self.configure(params)
        self.reset()
        self.stop_requested = False
        epsilon = self.epsilon

        if not await self._safe_send(websocket, {"type": "room_info", **self.map_info()}):
            return

        for stage_idx in range(len(STAGES)):
            if self.stop_requested:
                break
            epsilon, disconnected = await self._run_stage(stage_idx, websocket, epsilon)
            if disconnected:
                return
            if self.stop_requested:
                break

        await self._safe_send(websocket, {
            "type": "training_complete",
            "best_episode": 0,
            "best_reward": 0,
            "stages_completed": self.current_stage + 1,
            "q_values": np.max(self.q_table, axis=-1).tolist(),
            "policy": np.argmax(self.q_table, axis=-1).tolist(),
            **self.map_info(),
        })

    # ---------- BaseRoom interface ----------

    def step(self, action):
        row, col = self.agent_pos
        nr, nc, reward, done = self.env_step(row, col, action, 0)
        self.agent_pos = (nr, nc)
        return (nr, nc), reward, done
