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


class Room3QLearning(BaseRoom):
    """Treasure Hunt room: off-policy Q-Learning.

    Agent must collect all artifacts (unordered bitmask), avoid a patrolling
    shark, and optionally use a one-time teleporting portal before reaching
    the exit.
    """

    def __init__(self):
        super().__init__()
        self.alpha = 0.1
        self.gamma = 0.95
        self.epsilon = 0.2
        self.epsilon_decay = 0.995
        self.episodes = 500
        self.max_steps = 300
        self.m_fragments = 3
        self.shark_speed = 3
        self.exit_reward = 100.0
        self.fragment_reward = 15.0
        self.shark_penalty = -25.0
        self.step_penalty = -0.1
        self.step_delay = 0.0

        self.artifacts = []
        self.patrol_cells = []
        self.q_table = None

        self.agent_pos = START
        self.bitmask = 0
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

    def _make_patrol(self):
        shark_row = random.randint(2, 7)
        c0 = random.randint(1, 5)
        c1 = min(8, c0 + random.randint(2, 4))
        forward = [(shark_row, c) for c in range(c0, c1 + 1)]
        backward = [(shark_row, c) for c in range(c1 - 1, c0, -1)]
        return forward + backward

    def reset(self):
        excluded = {START, EXIT}
        self.artifacts = self._random_cells(self.m_fragments, excluded)
        self.patrol_cells = self._make_patrol()

        self.q_table = np.zeros((ROWS, COLS, 1 << self.m_fragments, 4))

        self.agent_pos = START
        self.bitmask = 0
        self.stop_requested = False
        self.paused = False
        return (*self.agent_pos, self.bitmask)

    def configure(self, params: dict):
        self.alpha = params.get("alpha", self.alpha)
        self.gamma = params.get("gamma", self.gamma)
        self.epsilon = params.get("epsilon", self.epsilon)
        self.epsilon_decay = params.get("epsilon_decay", self.epsilon_decay)
        self.episodes = params.get("episodes", self.episodes)
        self.max_steps = params.get("max_steps", self.max_steps)
        self.shark_speed = params.get("shark_speed", self.shark_speed)
        new_m = params.get("M_fragments", self.m_fragments)
        if new_m != self.m_fragments:
            self.m_fragments = new_m
            self.reset()
        self.exit_reward = params.get("exit_reward", self.exit_reward)
        self.fragment_reward = params.get("fragment_reward", self.fragment_reward)
        self.shark_penalty = params.get("shark_penalty", self.shark_penalty)
        self.step_penalty = params.get("step_penalty", self.step_penalty)
        # See the matching comment in room2_sarsa.py: Windows' default
        # asyncio timer granularity makes sub-~15ms sleeps essentially
        # no-ops, so any non-zero delay is floored to a value confirmed to
        # actually delay.
        requested_delay_ms = params.get("step_delay_ms", 0)
        self.step_delay = max(requested_delay_ms, 30) / 1000.0 if requested_delay_ms > 0 else 0.0

    def map_info(self):
        return {"artifacts": self.artifacts, "shark_patrol": self.patrol_cells}

    # ---------- dynamics (model-free, shared by both algorithms) ----------

    def _intended_next(self, row, col, action_idx):
        dr, dc = ACTIONS[action_idx]
        nr, nc = row + dr, col + dc
        if nr < 0 or nr >= ROWS or nc < 0 or nc >= COLS:
            return (row, col)
        return (nr, nc)

    def shark_pos_at(self, step_count):
        idx = (step_count // self.shark_speed) % len(self.patrol_cells)
        return self.patrol_cells[idx]

    def random_portal_position(self):
        excluded = set(self.artifacts) | set(self.patrol_cells) | {START, EXIT}
        candidates = [(r, c) for r in range(ROWS) for c in range(COLS) if (r, c) not in excluded]
        return random.choice(candidates)

    def env_step(self, row, col, bitmask, action_idx, step_count, portal_pos, portal_used):
        nxt = self._intended_next(row, col, action_idx)

        if nxt == self.shark_pos_at(step_count):
            return (START[0], START[1], bitmask, portal_used), self.shark_penalty, False

        if nxt == EXIT:
            full_mask = (1 << self.m_fragments) - 1
            if bitmask == full_mask:
                return (EXIT[0], EXIT[1], bitmask, portal_used), self.exit_reward, True
            return (nxt[0], nxt[1], bitmask, portal_used), self.step_penalty, False

        for i, pos in enumerate(self.artifacts):
            if nxt == pos and not (bitmask & (1 << i)):
                return (nxt[0], nxt[1], bitmask | (1 << i), portal_used), self.fragment_reward, False

        if not portal_used and portal_pos is not None and nxt == portal_pos:
            d = random.randint(3, 5)
            tr = min(ROWS - 1, nxt[0] + d)
            tc = min(COLS - 1, nxt[1] + d)
            return (tr, tc, bitmask, True), self.step_penalty, False

        return (nxt[0], nxt[1], bitmask, portal_used), self.step_penalty, False

    def epsilon_greedy(self, table, row, col, bitmask, epsilon):
        if random.random() < epsilon:
            return random.randrange(4)
        return int(np.argmax(table[row, col, bitmask]))

    # ---------- episode runner ----------

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

    async def _run_episode_qlearning(self, epsilon, episode, websocket, total_episodes):
        row, col, bitmask = START[0], START[1], 0
        portal_pos = self.random_portal_position()
        portal_used = False
        trajectory = [{"pos": [row, col], "reward": 0.0, "bitmask": bitmask}]
        total_reward = 0.0
        portal_discovered = False
        disconnected = False
        step = 0

        for step in range(self.max_steps):
            action = self.epsilon_greedy(self.q_table, row, col, bitmask, epsilon)
            (nr, nc, nb, nu), reward, done = self.env_step(row, col, bitmask, action, step, portal_pos, portal_used)
            if nu and not portal_used:
                portal_discovered = True
            portal_used = nu

            best_next = 0.0 if done else np.max(self.q_table[nr, nc, nb])
            td_target = reward if done else reward + self.gamma * best_next
            self.q_table[row, col, bitmask, action] += self.alpha * (td_target - self.q_table[row, col, bitmask, action])

            row, col, bitmask = nr, nc, nb
            trajectory.append({"pos": [row, col], "reward": reward, "bitmask": bitmask})
            total_reward += reward

            if step % 5 == 0:
                if not await self._safe_send(websocket, {
                    "type": "step_update",
                    "episode": episode,
                    "step": step,
                    "agent_pos": [row, col],
                    "reward": reward,
                    "shark_pos": list(self.shark_pos_at(step)),
                    "q_values": np.max(self.q_table[:, :, bitmask, :], axis=-1).tolist(),
                    "done": done,
                    "total_episodes": total_episodes,
                    "epsilon": epsilon,
                }):
                    disconnected = True
                    break
                if self.step_delay > 0:
                    await asyncio.sleep(self.step_delay)
            if done:
                break

        return trajectory, total_reward, step, portal_discovered, done, disconnected, portal_pos

    # ---------- training orchestration ----------

    async def train(self, params: dict, websocket):
        self.configure(params)
        self.q_table = np.zeros((ROWS, COLS, 1 << self.m_fragments, 4))
        self.stop_requested = False
        epsilon = self.epsilon
        portal_first_episode = None
        episode_rewards = {}
        episode_portals = {}

        if not await self._safe_send(websocket, {"type": "room_info", **self.map_info()}):
            return

        for episode in range(self.episodes):
            if self.stop_requested:
                break
            await self.wait_if_paused()
            if self.stop_requested:
                break

            traj, reward, steps, portal_discovered, success, disconnected, portal_pos = await self._run_episode_qlearning(
                epsilon, episode, websocket, self.episodes
            )
            if disconnected:
                return
            if portal_discovered and portal_first_episode is None:
                portal_first_episode = episode
            episode_portals[episode] = list(portal_pos)
            self.save_episode(episode, traj)
            episode_rewards[episode] = reward
            epsilon = max(0.01, epsilon * self.epsilon_decay)

            if not await self._safe_send(websocket, {
                "type": "episode_end",
                "episode": episode, "total_reward": reward, "steps": steps, "epsilon": epsilon,
                "success": success, "outcome": "success" if success else "fail",
            }):
                return
            await asyncio.sleep(0)

        best_episode = max(episode_rewards, key=episode_rewards.get) if episode_rewards else 0
        best_portal = episode_portals.get(best_episode)
        # The portal teleports 3-5 steps diagonally toward exit; use d=4 as
        # the representative midpoint destination for the heatmap overlay.
        if best_portal:
            d = 4
            portal_dest = [
                min(ROWS - 1, best_portal[0] + d),
                min(COLS - 1, best_portal[1] + d),
            ]
        else:
            portal_dest = None
        await self._safe_send(websocket, {
            "type": "training_complete",
            "best_episode": best_episode,
            "best_reward": episode_rewards.get(best_episode, 0.0),
            "policy": np.argmax(self.q_table[:, :, 0, :], axis=-1).tolist(),
            "q_values": np.max(self.q_table[:, :, 0, :], axis=-1).tolist(),
            "q_values_all": [
                np.max(self.q_table[:, :, b, :], axis=-1).tolist()
                for b in range(1 << self.m_fragments)
            ],
            "portal_first_episode": portal_first_episode,
            "best_portal": best_portal,
            "best_portal_dest": portal_dest,
            **self.map_info(),
        })

