import asyncio
import random

import numpy as np
import torch
import torch.nn.functional as F
from starlette.websockets import WebSocketDisconnect

from .base_room import BaseRoom
from models.policy_network import PolicyNetwork

torch.set_num_threads(1)

ROWS, COLS = 10, 10
START = (0, 0)
EXIT = (9, 9)

ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
ACTION_NAMES = ["UP", "DOWN", "LEFT", "RIGHT"]


class Room7Reinforce(BaseRoom):
    """The Final Trial — Policy Gradient (REINFORCE).

    Every other room is value-based: learn how good an action is, then act
    greedily (or near-greedily) w.r.t. that estimate. REINFORCE is
    policy-based instead - a small neural network maps a state directly to
    action *probabilities*, and after each full episode every action taken
    gets nudged up or down by how good the episode's actual discounted
    return was, via the policy-gradient update:

        loss = -sum_t log(pi(a_t | s_t)) * G_t

    There's no Q-table, no epsilon-greedy, no bootstrapping - just a policy
    that gradually sharpens from uniform-random toward confidently choosing
    good actions, one full Monte-Carlo episode at a time.
    """

    def __init__(self):
        super().__init__()
        self.learning_rate = 0.01
        self.gamma = 0.95
        self.episodes = 500
        self.max_steps = 200
        self.slip_prob = 0.1
        self.exit_reward = 100.0
        self.step_penalty = -0.1
        self.step_delay = 0.0

        self.walls = set()
        self.vents = set()
        self.policy = None
        self.optimizer = None

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
        return cells

    def _new_policy(self):
        self.policy = PolicyNetwork(state_dim=ROWS * COLS, action_dim=4)
        self.optimizer = torch.optim.Adam(self.policy.parameters(), lr=self.learning_rate)

    def reset(self):
        excluded = {START, EXIT}
        self.walls = set(self._random_cells(8, excluded))
        excluded |= self.walls
        self.vents = set(self._random_cells(6, excluded))

        self._new_policy()
        self.agent_pos = START
        self.stop_requested = False
        self.paused = False
        return (*self.agent_pos,)

    def configure(self, params: dict):
        self.learning_rate = params.get("learning_rate", self.learning_rate)
        self.gamma = params.get("gamma", self.gamma)
        self.episodes = params.get("episodes", self.episodes)
        self.max_steps = params.get("max_steps", self.max_steps)
        # See the matching comment in room2_sarsa.py: Windows' default
        # asyncio timer granularity makes sub-~15ms sleeps essentially
        # no-ops, so any non-zero delay is floored to a value confirmed to
        # actually delay.
        requested_delay_ms = params.get("step_delay_ms", 0)
        self.step_delay = max(requested_delay_ms, 30) / 1000.0 if requested_delay_ms > 0 else 0.0

    def map_info(self):
        return {"walls": list(self.walls), "vents": list(self.vents)}

    # ---------- dynamics (model-free, stochastic on vents) ----------

    def _intended_next(self, row, col, action_idx):
        dr, dc = ACTIONS[action_idx]
        nr, nc = row + dr, col + dc
        if nr < 0 or nr >= ROWS or nc < 0 or nc >= COLS or (nr, nc) in self.walls:
            return (row, col)
        return (nr, nc)

    def env_step(self, row, col, action_idx):
        if (row, col) in self.vents and random.random() < self.slip_prob:
            action_idx = random.choice([a for a in range(4) if a != action_idx])
        nr, nc = self._intended_next(row, col, action_idx)
        if (nr, nc) == EXIT:
            return (nr, nc), self.exit_reward, True
        return (nr, nc), self.step_penalty, False

    # ---------- policy network ----------

    def _encode(self, row, col):
        vec = torch.zeros(ROWS * COLS)
        vec[row * COLS + col] = 1.0
        return vec

    def _action_probs(self, row, col):
        with torch.no_grad():
            logits = self.policy(self._encode(row, col))
            return F.softmax(logits, dim=-1)

    def _compute_confidence_and_policy(self):
        """For every cell: the policy's confidence (how far its most-likely
        action's probability is from uniform-random 0.25, scaled to
        0=totally unsure..1=fully deterministic) and which action that is -
        used for the confidence heatmap and the 3D scene's policy arrows."""
        with torch.no_grad():
            states = torch.stack([self._encode(r, c) for r in range(ROWS) for c in range(COLS)])
            logits = self.policy(states)
            probs = F.softmax(logits, dim=-1)
            max_probs, actions = probs.max(dim=-1)
            confidence = ((max_probs - 0.25) / 0.75).clamp(0, 1)
        confidence_table = confidence.view(ROWS, COLS).tolist()
        policy_table = actions.view(ROWS, COLS).tolist()
        return confidence_table, policy_table

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
        # A fresh network each "Train" click (same map, see reset() for
        # generating a brand-new map), since retraining REINFORCE on
        # partially-trained weights isn't the comparison this room is for.
        self._new_policy()
        self.stop_requested = False
        episode_rewards = {}

        if not await self._safe_send(websocket, {"type": "room_info", **self.map_info()}):
            return

        for episode in range(self.episodes):
            if self.stop_requested:
                break
            await self.wait_if_paused()
            if self.stop_requested:
                break

            row, col = START
            log_probs = []
            rewards = []
            trajectory = [{"pos": [row, col], "reward": 0.0}]
            disconnected = False
            done = False

            for step in range(self.max_steps):
                logits = self.policy(self._encode(row, col))
                probs = F.softmax(logits, dim=-1)
                dist = torch.distributions.Categorical(probs)
                action = dist.sample()
                log_prob = dist.log_prob(action)

                (nr, nc), reward, done = self.env_step(row, col, action.item())

                log_probs.append(log_prob)
                rewards.append(reward)
                row, col = nr, nc
                trajectory.append({"pos": [row, col], "reward": reward})

                if step % 5 == 0 or done:
                    if not await self._safe_send(websocket, {
                        "type": "step_update",
                        "episode": episode,
                        "step": step,
                        "agent_pos": [row, col],
                        "action_probs": probs.detach().tolist(),
                        "total_episodes": self.episodes,
                        "done": done,
                    }):
                        disconnected = True
                        break
                    if self.step_delay > 0:
                        await asyncio.sleep(self.step_delay)
                if done:
                    break

            if disconnected:
                return

            # === REINFORCE update: walk the whole episode's discounted
            # returns G_t, normalize them (a simple variance-reducing
            # baseline - learn "better/worse than this episode's average",
            # not raw reward magnitudes), then nudge every action taken
            # toward higher probability if its return was above average.
            G = 0.0
            returns = []
            for r in reversed(rewards):
                G = r + self.gamma * G
                returns.insert(0, G)
            returns_t = torch.tensor(returns, dtype=torch.float32)
            if returns_t.numel() > 1:
                returns_t = (returns_t - returns_t.mean()) / (returns_t.std() + 1e-8)

            loss = -(torch.stack(log_probs) * returns_t).sum()
            self.optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.policy.parameters(), 5.0)
            self.optimizer.step()

            total_reward = sum(rewards)
            episode_rewards[episode] = total_reward
            self.save_episode(episode, trajectory)

            confidence_table, policy_table = self._compute_confidence_and_policy()
            if not await self._safe_send(websocket, {
                "type": "episode_end",
                "episode": episode,
                "total_reward": total_reward,
                "success": done,
                "outcome": "success" if done else "fail",
                "confidence": confidence_table,
                "policy": policy_table,
            }):
                return
            await asyncio.sleep(0)

        best_episode = max(episode_rewards, key=episode_rewards.get) if episode_rewards else 0
        confidence_table, policy_table = self._compute_confidence_and_policy()
        await self._safe_send(websocket, {
            "type": "training_complete",
            "best_episode": best_episode,
            "best_reward": episode_rewards.get(best_episode, 0.0),
            "confidence": confidence_table,
            "policy": policy_table,
            **self.map_info(),
        })

    # ---------- BaseRoom interface ----------

    def step(self, action):
        row, col = self.agent_pos
        (nr, nc), reward, done = self.env_step(row, col, action)
        self.agent_pos = (nr, nc)
        return (nr, nc), reward, done
