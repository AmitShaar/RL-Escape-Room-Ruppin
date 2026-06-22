import asyncio

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from rooms.room1_dp import Room1DP
from rooms.room2_sarsa import Room2SARSA

app = FastAPI(title="Deep Sea RL")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_rooms = {}


def get_room(room_id: int):
    if room_id not in _rooms:
        if room_id == 1:
            _rooms[room_id] = Room1DP()
        elif room_id == 2:
            _rooms[room_id] = Room2SARSA()
        else:
            raise KeyError(f"Room {room_id} is not implemented yet")
    return _rooms[room_id]


@app.get("/")
async def health():
    return {"status": "ok", "service": "deep-sea-rl-backend"}


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: int):
    await websocket.accept()
    try:
        room = get_room(room_id)
    except KeyError as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close()
        return

    if hasattr(room, "map_info"):
        await websocket.send_json({"type": "room_info", **room.map_info()})

    train_task = None
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "start_training":
                if train_task and not train_task.done():
                    room.request_stop()
                    await train_task
                room.stop_requested = False
                room.paused = False
                train_task = asyncio.create_task(room.train(data.get("params", {}), websocket))

            elif msg_type == "pause_training":
                room.request_pause()

            elif msg_type == "resume_training":
                room.request_resume()

            elif msg_type == "reset":
                if train_task and not train_task.done():
                    room.request_stop()
                    await train_task
                room.reset()
                info = room.map_info() if hasattr(room, "map_info") else {}
                await websocket.send_json({"type": "reset_complete", **info})

            elif msg_type == "get_replay":
                replay = room.get_replay(data.get("episode", 0))
                await websocket.send_json({"type": "replay_data", **replay})

            else:
                await websocket.send_json({"type": "error", "message": f"unknown message type: {msg_type}"})

    except WebSocketDisconnect:
        if train_task and not train_task.done():
            room.request_stop()
