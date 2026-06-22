import asyncio
import random

import numpy as np

from .base_room import BaseRoom

ROWS, COLS = 10, 10
START = (0, 0)
EXIT = (9, 9)

# action index -> (d_row, d_col), order matches frontend convention
ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
ACTION_NAMES = ["UP", "DOWN", "LEFT", "RIGHT"]


class Room1DP(BaseRoom):
    """Sonar Mapping room: known-model GridWorld solved with Value Iteration."""

    def __init__(self):
        super().__init__()
        self.num_coral = 8
        self.num_vents = 6
        self.num_traps = 3
        self.slip_prob = 0.1
        self.gamma = 0.95
        self.theta = 1e-4

        self.walls = set()
        self.vents = set()
        self.traps = set()

        self.v_table = np.zeros((ROWS, COLS))
        self.policy = np.full((ROWS, COLS), -1, dtype=int)

        self.agent_pos = START
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
        return set(cells)

    def reset(self):
        excluded = {START, EXIT}
        self.walls = self._random_cells(self.num_coral, excluded)
        excluded = excluded | self.walls
        self.vents = self._random_cells(self.num_vents, excluded)
        excluded = excluded | self.vents
        self.traps = self._random_cells(self.num_traps, excluded)

        self.v_table = np.zeros((ROWS, COLS))
        self.policy = np.full((ROWS, COLS), -1, dtype=int)
        self.agent_pos = START
        self.stop_requested = False
        self.paused = False
        return self.agent_pos

    def configure(self, params: dict):
        self.gamma = params.get("gamma", self.gamma)
        self.theta = params.get("theta", self.theta)
        self.slip_prob = params.get("slip_prob", self.slip_prob)
        self.num_coral = params.get("num_coral", self.num_coral)
        self.num_vents = params.get("num_vents", self.num_vents)
        self.num_traps = params.get("num_traps", self.num_traps)

    # ---------- transition model (known, used by DP) ----------

    def _intended_next(self, row, col, action_idx):
        dr, dc = ACTIONS[action_idx]
        nr, nc = row + dr, col + dc
        if nr < 0 or nr >= ROWS or nc < 0 or nc >= COLS or (nr, nc) in self.walls:
            return (row, col)
        return (nr, nc)

    def transitions(self, state, action_idx):
        """Returns list of (prob, next_state, reward, done) for state s, action a."""
        if state == EXIT:
            return [(1.0, EXIT, 0.0, True)]

        row, col = state
        if state in self.vents:
            raw_outcomes = []
            for a_idx in range(4):
                prob = (1 - self.slip_prob) if a_idx == action_idx else self.slip_prob / 3
                raw_outcomes.append((prob, self._intended_next(row, col, a_idx)))
        else:
            raw_outcomes = [(1.0, self._intended_next(row, col, action_idx))]

        merged = {}
        for prob, nxt in raw_outcomes:
            if nxt in self.traps:
                key = (START, -20.0, False)
            elif nxt == EXIT:
                key = (EXIT, 100.0, True)
            else:
                key = (nxt, -0.1, False)
            merged[key] = merged.get(key, 0.0) + prob

        return [(prob, *key) for key, prob in merged.items()]

    # ---------- value iteration ----------

    def _bellman_value(self, state, v_table):
        best = -np.inf
        best_action = -1
        for a_idx in range(4):
            total = 0.0
            for prob, nxt, reward, done in self.transitions(state, a_idx):
                future = 0.0 if done else self.gamma * v_table[nxt[0], nxt[1]]
                total += prob * (reward + future)
            if total > best:
                best = total
                best_action = a_idx
        return best, best_action

    async def train(self, params: dict, websocket):
        self.configure(params)
        self.v_table = np.zeros((ROWS, COLS))
        self.policy = np.full((ROWS, COLS), -1, dtype=int)
        self.stop_requested = False

        max_iterations = 1000
        iteration = 0
        delta = float("inf")

        while iteration < max_iterations and delta >= self.theta:
            if self.stop_requested:
                break
            await self.wait_if_paused()
            if self.stop_requested:
                break

            new_v = np.zeros((ROWS, COLS))
            new_policy = np.full((ROWS, COLS), -1, dtype=int)
            delta = 0.0

            for r in range(ROWS):
                for c in range(COLS):
                    state = (r, c)
                    if state == EXIT or state in self.walls:
                        new_v[r, c] = 0.0
                        continue
                    best_value, best_action = self._bellman_value(state, self.v_table)
                    new_v[r, c] = best_value
                    new_policy[r, c] = best_action
                    delta = max(delta, abs(best_value - self.v_table[r, c]))

            self.v_table = new_v
            self.policy = new_policy
            iteration += 1

            await websocket.send_json({
                "type": "vi_iteration",
                "iteration": iteration,
                "delta": delta,
                "v_table": self.v_table.tolist(),
                "policy": self.policy.tolist(),
            })
            await asyncio.sleep(0)

        trajectory = self._rollout_policy()
        self.save_episode(0, trajectory)

        await websocket.send_json({
            "type": "training_complete",
            "best_episode": iteration,
            "best_reward": float(self.v_table[START[0], START[1]]),
            "policy": self.policy.tolist(),
            "v_table": self.v_table.tolist(),
            "walls": list(self.walls),
            "vents": list(self.vents),
            "traps": list(self.traps),
        })

    def _rollout_policy(self, max_steps=200):
        trajectory = []
        state = START
        for _ in range(max_steps):
            action_idx = self.policy[state[0], state[1]]
            if action_idx < 0:
                break
            outcomes = self.transitions(state, action_idx)
            probs = [o[0] for o in outcomes]
            chosen = random.choices(outcomes, weights=probs, k=1)[0]
            _, nxt, reward, done = chosen
            trajectory.append({"pos": list(nxt), "reward": reward, "action": ACTION_NAMES[action_idx]})
            state = nxt
            if done:
                break
        return trajectory

    # ---------- BaseRoom interface ----------

    def step(self, action):
        outcomes = self.transitions(self.agent_pos, action)
        probs = [o[0] for o in outcomes]
        _, nxt, reward, done = random.choices(outcomes, weights=probs, k=1)[0]
        self.agent_pos = nxt
        return nxt, reward, done
