import asyncio
import random

import numpy as np
from starlette.websockets import WebSocketDisconnect

from .base_room import BaseRoom


class Room5Bandit(BaseRoom):
    """The Bone Machines — Multi-Armed Bandit.

    3 slot machines, each with a different hidden probability of giving
    חיזקי a bone. No states, no movement — just "which action gives the
    best reward on average?" Learned with epsilon-greedy action selection
    and an incremental-mean Q-value update: Q(a) += alpha * (reward - Q(a)).
    """

    def __init__(self):
        super().__init__()
        self.n_machines = 3
        self.epsilon = 0.2
        self.alpha = 0.1
        self.n_pulls = 200
        self.step_delay = 0.0

        self.true_probs = []
        self.q_values = [0.0] * self.n_machines
        self.pull_counts = [0] * self.n_machines
        self.total_pulls = 0
        self.total_reward = 0.0
        self.reset()

    def reset(self):
        self.true_probs = sorted(random.uniform(0.1, 0.9) for _ in range(self.n_machines))
        self.q_values = [0.0] * self.n_machines
        self.pull_counts = [0] * self.n_machines
        self.total_pulls = 0
        self.total_reward = 0.0
        self.stop_requested = False
        self.paused = False
        return None

    def configure(self, params: dict):
        self.epsilon = params.get("epsilon", self.epsilon)
        self.alpha = params.get("alpha", self.alpha)
        self.n_pulls = params.get("n_pulls", self.n_pulls)
        # See the matching comment in room2_sarsa.py: Windows' default
        # asyncio timer granularity makes sub-~15ms sleeps essentially
        # no-ops, so any non-zero delay is floored to a value confirmed to
        # actually delay.
        requested_delay_ms = params.get("step_delay_ms", 0)
        self.step_delay = max(requested_delay_ms, 30) / 1000.0 if requested_delay_ms > 0 else 0.0

    def map_info(self):
        return {
            "n_machines": self.n_machines,
            "n_pulls": self.n_pulls,
        }

    def pull(self, machine_idx):
        return 1.0 if random.random() < self.true_probs[machine_idx] else 0.0

    def select_machine(self, epsilon):
        if random.random() < epsilon:
            return random.randint(0, self.n_machines - 1)
        return int(np.argmax(self.q_values))

    async def single_pull(self, machine_idx, params):
        """One manually- (or autoplay-) triggered pull on a specific machine.

        Unlike train()'s loop, the caller (the interactive frontend) always
        picks the exact machine - epsilon only matters there for the
        autoplay toggle's own local choice, not anything server-side. This
        is the path the redesigned click-to-pull UI uses; train() is left
        intact below purely as a fallback, since the room can still receive
        a "start_training" message even though the UI no longer sends one.
        """
        self.alpha = params.get("alpha", self.alpha)
        self.n_pulls = params.get("n_pulls", self.n_pulls)

        reward = self.pull(machine_idx)
        self.pull_counts[machine_idx] += 1
        self.total_pulls += 1
        self.total_reward += reward
        self.q_values[machine_idx] += self.alpha * (reward - self.q_values[machine_idx])

        result = {
            "type": "pull_result",
            "machine": machine_idx,
            "reward": reward,
            "q_values": self.q_values[:],
            "pull_counts": self.pull_counts[:],
            "total_pulls": self.total_pulls,
            "n_pulls": self.n_pulls,
            "total_reward": self.total_reward,
            "done": self.total_pulls >= self.n_pulls,
        }
        if result["done"]:
            result["true_probs"] = self.true_probs
            result["best_machine"] = int(np.argmax(self.q_values))
        return result

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

    async def train(self, params: dict, websocket):
        self.configure(params)
        self.reset()
        self.stop_requested = False

        total_reward = 0.0
        history = []

        if not await self._safe_send(websocket, {
            "type": "room_info",
            "n_machines": self.n_machines,
            "n_pulls": self.n_pulls,
        }):
            return

        for pull_num in range(self.n_pulls):
            if self.stop_requested:
                break
            await self.wait_if_paused()
            if self.stop_requested:
                break

            machine = self.select_machine(self.epsilon)
            reward = self.pull(machine)
            self.pull_counts[machine] += 1
            total_reward += reward

            self.q_values[machine] += self.alpha * (reward - self.q_values[machine])

            history.append({
                "pull": pull_num,
                "machine": machine,
                "reward": reward,
                "q_values": self.q_values[:],
                "pull_counts": self.pull_counts[:],
                "total_reward": total_reward,
            })

            if not await self._safe_send(websocket, {
                "type": "pull_result",
                "pull": pull_num,
                "machine": machine,
                "reward": reward,
                "q_values": self.q_values[:],
                "pull_counts": self.pull_counts[:],
                "total_reward": total_reward,
            }):
                return
            if self.step_delay > 0:
                await asyncio.sleep(self.step_delay)
            await asyncio.sleep(0)

        self.episode_history[0] = history

        best_machine = int(np.argmax(self.q_values))
        await self._safe_send(websocket, {
            "type": "training_complete",
            "best_machine": best_machine,
            "q_values": self.q_values[:],
            "pull_counts": self.pull_counts[:],
            "true_probs": self.true_probs,
            "total_reward": total_reward,
            "best_reward": total_reward,
            "best_episode": 0,
        })

    # ---------- BaseRoom interface ----------

    def step(self, action):
        reward = self.pull(action)
        return None, reward, False

    def get_replay(self, episode: int):
        return {"episode": 0, "trajectory": self.episode_history.get(0, [])}
