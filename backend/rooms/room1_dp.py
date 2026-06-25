import asyncio
import random

import numpy as np
from starlette.websockets import WebSocketDisconnect

from .base_room import BaseRoom

ROWS, COLS = 10, 10
START = (0, 0)
EXIT = (9, 9)

# action index -> (d_row, d_col), order matches frontend convention
ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
ACTION_NAMES = ["UP", "DOWN", "LEFT", "RIGHT"]


class Room1DP(BaseRoom):
    """Sonar Mapping room: known-model GridWorld solved with Value Iteration.

    State is (row, col, treats_bitmask). Treats are one-time collectibles
    tracked in the bitmask rather than given as a repeatable reward - with a
    repeatable reward, Value Iteration's fixed point can genuinely prefer an
    infinite oscillation next to a treat over ever reaching the exit (the
    discounted value of farming forever can exceed a one-time exit reward),
    so collection has to be real MDP state, not just a visual flourish.
    """

    def __init__(self):
        super().__init__()
        self.num_coral = 8
        self.num_vents = 6
        self.num_traps = 3
        self.num_treats = 5
        self.num_holes = 4
        self.slip_prob = 0.1
        self.gamma = 0.95
        self.theta = 1e-4
        self.exit_reward = 100.0
        self.trap_reward_val = -20.0
        self.step_penalty = -0.1
        self.treat_reward = 5.0

        self.walls = set()
        self.vents = set()
        self.traps = set()
        self.treats = []
        self.treat_index = {}
        self.holes = set()

        self.v_table = None
        self.policy = None

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

    def reset(self):
        excluded = {START, EXIT}
        self.walls = set(self._random_cells(self.num_coral, excluded))
        excluded |= self.walls
        self.vents = set(self._random_cells(self.num_vents, excluded))
        excluded |= self.vents
        self.traps = set(self._random_cells(self.num_traps, excluded))
        excluded |= self.traps
        self.treats = self._random_cells(self.num_treats, excluded)
        excluded |= set(self.treats)
        self.holes = set(self._random_cells(self.num_holes, excluded))
        self.treat_index = {pos: i for i, pos in enumerate(self.treats)}

        n_bitmasks = 1 << self.num_treats
        self.v_table = np.zeros((ROWS, COLS, n_bitmasks))
        self.policy = np.full((ROWS, COLS, n_bitmasks), -1, dtype=int)
        self.agent_pos = START
        self.bitmask = 0
        self.stop_requested = False
        self.paused = False
        return (*self.agent_pos, self.bitmask)

    def configure(self, params: dict):
        self.gamma = params.get("gamma", self.gamma)
        self.theta = params.get("theta", self.theta)
        self.slip_prob = params.get("slip_prob", self.slip_prob)
        self.num_coral = params.get("num_coral", self.num_coral)
        self.num_vents = params.get("num_vents", self.num_vents)
        self.num_traps = params.get("num_traps", self.num_traps)
        self.exit_reward = params.get("exit_reward", self.exit_reward)
        self.trap_reward_val = params.get("trap_reward", self.trap_reward_val)
        self.step_penalty = params.get("step_penalty", self.step_penalty)
        self.num_holes = params.get("num_holes", self.num_holes)
        self.treat_reward = params.get("treat_reward", self.treat_reward)
        # num_treats sizes the bitmask dimension of v_table/policy, so a
        # change has to regenerate the map (same pattern as K_beacons /
        # M_fragments in rooms 2/3) rather than silently going stale.
        new_num_treats = params.get("num_treats", self.num_treats)
        if new_num_treats != self.num_treats:
            self.num_treats = new_num_treats
            self.reset()

    # ---------- transition model (known, used by DP) ----------

    def _intended_next(self, row, col, action_idx):
        dr, dc = ACTIONS[action_idx]
        nr, nc = row + dr, col + dc
        if nr < 0 or nr >= ROWS or nc < 0 or nc >= COLS or (nr, nc) in self.walls:
            return (row, col)
        return (nr, nc)

    def transitions(self, state, action_idx):
        """Returns list of (prob, next_state, reward, done) for state s=(row,col,bitmask), action a."""
        row, col, bitmask = state
        if (row, col) == EXIT:
            return [(1.0, (EXIT[0], EXIT[1], bitmask), 0.0, True)]

        if (row, col) in self.vents:
            raw_outcomes = []
            for a_idx in range(4):
                prob = (1 - self.slip_prob) if a_idx == action_idx else self.slip_prob / 3
                raw_outcomes.append((prob, self._intended_next(row, col, a_idx)))
        else:
            raw_outcomes = [(1.0, self._intended_next(row, col, action_idx))]

        merged = {}
        for prob, nxt in raw_outcomes:
            # Holes teleport back to start with no reward penalty; traps
            # penalize but leave the agent right where it stepped (see the
            # docstring above for why these aren't both "reset + penalty").
            if nxt in self.holes:
                key = ((START[0], START[1], bitmask), 0.0, False)
            elif nxt == EXIT:
                key = ((EXIT[0], EXIT[1], bitmask), self.exit_reward, True)
            elif nxt in self.traps:
                key = ((nxt[0], nxt[1], bitmask), self.trap_reward_val, False)
            elif nxt in self.treat_index:
                bit = 1 << self.treat_index[nxt]
                if bitmask & bit:
                    key = ((nxt[0], nxt[1], bitmask), self.step_penalty, False)
                else:
                    key = ((nxt[0], nxt[1], bitmask | bit), self.treat_reward, False)
            else:
                key = ((nxt[0], nxt[1], bitmask), self.step_penalty, False)
            merged[key] = merged.get(key, 0.0) + prob

        return [(prob, *key) for key, prob in merged.items()]

    # ---------- value iteration ----------

    def _bellman_value_vec(self, r, c, v_table, bm_arr):
        """Vectorized Bellman backup for cell (r, c) across every bitmask at
        once. Per-state Python loops over up to 2**15 bitmasks (one Python
        function call each) is what made num_treats=15 take ~980s; this
        reduces it to a handful of NumPy array ops per cell regardless of
        how many bitmasks there are, since _intended_next/the outcome type
        for a given action only depends on (r, c) and the slip roll, not on
        which treats are already collected.
        """
        best_value = np.full(bm_arr.shape, -np.inf)
        best_action = np.full(bm_arr.shape, -1, dtype=int)
        is_vent = (r, c) in self.vents

        for a_idx in range(4):
            total = np.zeros(bm_arr.shape)
            if is_vent:
                outcomes = [
                    ((1 - self.slip_prob) if k == a_idx else self.slip_prob / 3, self._intended_next(r, c, k))
                    for k in range(4)
                ]
            else:
                outcomes = [(1.0, self._intended_next(r, c, a_idx))]

            for prob, nxt in outcomes:
                # Same hole/trap split as transitions() above: holes reset
                # position with zero reward, traps penalize in place.
                if nxt in self.holes:
                    reward, next_rc, next_bm, done = 0.0, START, bm_arr, False
                elif nxt == EXIT:
                    reward, next_rc, next_bm, done = self.exit_reward, EXIT, bm_arr, True
                elif nxt in self.traps:
                    reward, next_rc, next_bm, done = self.trap_reward_val, nxt, bm_arr, False
                elif nxt in self.treat_index:
                    bit = 1 << self.treat_index[nxt]
                    has_bit = (bm_arr & bit) != 0
                    reward = np.where(has_bit, self.step_penalty, self.treat_reward)
                    next_bm = np.where(has_bit, bm_arr, bm_arr | bit)
                    next_rc, done = nxt, False
                else:
                    reward, next_rc, next_bm, done = self.step_penalty, nxt, bm_arr, False

                future = 0.0 if done else self.gamma * v_table[next_rc[0], next_rc[1], next_bm]
                total = total + prob * (reward + future)

            better = total > best_value
            best_value = np.where(better, total, best_value)
            best_action = np.where(better, a_idx, best_action)

        return best_value, best_action

    def map_info(self):
        return {
            "walls": list(self.walls),
            "vents": list(self.vents),
            "traps": list(self.traps),
            "treats": list(self.treats),
            "holes": list(self.holes),
        }

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
        n_bitmasks = 1 << self.num_treats
        bm_arr = np.arange(n_bitmasks)
        self.v_table = np.zeros((ROWS, COLS, n_bitmasks))
        self.policy = np.full((ROWS, COLS, n_bitmasks), -1, dtype=int)
        self.stop_requested = False
        if not await self._safe_send(websocket, {"type": "room_info", **self.map_info()}):
            return

        max_iterations = 1000
        iteration = 0
        delta = float("inf")
        disconnected = False

        while iteration < max_iterations and delta >= self.theta:
            if self.stop_requested or disconnected:
                break
            await self.wait_if_paused()
            if self.stop_requested:
                break

            new_v = np.zeros_like(self.v_table)
            new_policy = np.full_like(self.policy, -1)
            # Only the bitmask=0 slice (no treats collected yet) is streamed
            # for the live heatmap/sweep - sending every bitmask slice would
            # blow up the message size for nothing the UI can show anyway.
            display_v = self.v_table[:, :, 0].copy()
            display_policy = self.policy[:, :, 0].copy()
            delta = 0.0

            for r in range(ROWS):
                for c in range(COLS):
                    # Holes are never an actual resting state: stepping into
                    # one redirects to START as part of that same
                    # transition (see transitions()/_bellman_value_vec()
                    # above), so V(hole)/policy(hole) would be a vacuous
                    # number nothing ever reads - skip it like walls/exit
                    # rather than compute (and display) a meaningless arrow.
                    if (r, c) == EXIT or (r, c) in self.walls or (r, c) in self.holes:
                        new_v[r, c, :] = 0.0
                        continue
                    best_value, best_action = self._bellman_value_vec(r, c, self.v_table, bm_arr)
                    new_v[r, c, :] = best_value
                    new_policy[r, c, :] = best_action
                    delta = max(delta, float(np.max(np.abs(best_value - self.v_table[r, c, :]))))

                display_v[r, :] = new_v[r, :, 0]
                display_policy[r, :] = new_policy[r, :, 0]
                if not await self._safe_send(websocket, {
                    "type": "vi_iteration",
                    "iteration": iteration + 1,
                    "current_row": r,
                    "delta": delta,
                    "v_table": display_v.tolist(),
                    "policy": display_policy.tolist(),
                }):
                    disconnected = True
                    break
                await asyncio.sleep(0.03)

            if disconnected:
                break
            self.v_table = new_v
            self.policy = new_policy
            iteration += 1

        if disconnected:
            return

        # The policy is deterministic but the environment isn't (slip_prob,
        # treat order encountered): roll it out `replay_episodes` times and
        # keep the best-reward one for replay, the same "best of N" meaning
        # best_episode/best_reward have in Rooms 2-4, rather than just
        # replaying a single arbitrary rollout.
        n_replay_episodes = max(1, params.get("replay_episodes", 1))
        best_episode_idx = 0
        best_total_reward = -float("inf")
        for ep in range(n_replay_episodes):
            trajectory = self._rollout_policy(max_steps=params.get("max_steps", 200))
            total_reward = sum(step["reward"] for step in trajectory)
            self.save_episode(ep, trajectory)
            if total_reward > best_total_reward:
                best_total_reward = total_reward
                best_episode_idx = ep

        await self._safe_send(websocket, {
            "type": "training_complete",
            "best_episode": best_episode_idx,
            "best_reward": best_total_reward,
            "policy": self.policy[:, :, 0].tolist(),
            "v_table": self.v_table[:, :, 0].tolist(),
            **self.map_info(),
        })

    def _rollout_policy(self, max_steps=200):
        trajectory = []
        state = (START[0], START[1], 0)
        for _ in range(max_steps):
            r, c, bm = state
            action_idx = self.policy[r, c, bm]
            if action_idx < 0:
                break
            outcomes = self.transitions(state, action_idx)
            probs = [o[0] for o in outcomes]
            chosen = random.choices(outcomes, weights=probs, k=1)[0]
            _, nxt, reward, done = chosen
            trajectory.append({
                "pos": [nxt[0], nxt[1]],
                "reward": reward,
                "bitmask": nxt[2],
                "action": ACTION_NAMES[action_idx],
            })
            state = nxt
            if done:
                break
        return trajectory

    # ---------- BaseRoom interface ----------

    def step(self, action):
        row, col = self.agent_pos
        state = (row, col, self.bitmask)
        outcomes = self.transitions(state, action)
        probs = [o[0] for o in outcomes]
        _, nxt, reward, done = random.choices(outcomes, weights=probs, k=1)[0]
        self.agent_pos = (nxt[0], nxt[1])
        self.bitmask = nxt[2]
        return nxt, reward, done
