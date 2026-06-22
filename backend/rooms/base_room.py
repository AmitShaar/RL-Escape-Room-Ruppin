import asyncio
from abc import ABC, abstractmethod


class BaseRoom(ABC):
    """Shared lifecycle for all RL rooms: reset/step env, train loop, replay storage."""

    def __init__(self):
        self.episode_history = {}
        self.paused = False
        self.stop_requested = False

    @abstractmethod
    def reset(self):
        ...

    @abstractmethod
    def step(self, action):
        ...

    @abstractmethod
    async def train(self, params: dict, websocket):
        ...

    def get_replay(self, episode: int):
        trajectory = self.episode_history.get(episode)
        if trajectory is None:
            return {"episode": episode, "trajectory": [], "error": "no such episode"}
        return {"episode": episode, "trajectory": trajectory}

    def save_episode(self, episode_num, trajectory):
        self.episode_history[episode_num] = trajectory

    def request_pause(self):
        self.paused = True

    def request_resume(self):
        self.paused = False

    def request_stop(self):
        self.stop_requested = True

    async def wait_if_paused(self):
        while self.paused and not self.stop_requested:
            await asyncio.sleep(0.05)
