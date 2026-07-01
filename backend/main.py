import asyncio

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from rooms.room1_dp import Room1DP
from rooms.room2_sarsa import Room2SARSA
from rooms.room3_qlearning import Room3QLearning
from rooms.room4_dqn import Room4DQN
from rooms.room5_storm import Room5Storm
from rooms.room6_curriculum import Room6Curriculum

app = FastAPI(title="Hizki In Space RL")

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
        elif room_id == 3:
            _rooms[room_id] = Room3QLearning()
        elif room_id == 4:
            _rooms[room_id] = Room4DQN()
        elif room_id == 5:
            _rooms[room_id] = Room5Storm()
        elif room_id == 6:
            _rooms[room_id] = Room6Curriculum()
        else:
            raise KeyError(f"Room {room_id} is not implemented yet")
    return _rooms[room_id]


@app.get("/")
async def health():
    return {"status": "ok", "service": "hizki-in-space-rl-backend"}


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

            elif msg_type == "test_generalization":
                if hasattr(room, "test_generalization"):
                    await room.test_generalization(websocket)
                else:
                    await websocket.send_json({"type": "error", "message": "generalization test not supported in this room"})

            else:
                await websocket.send_json({"type": "error", "message": f"unknown message type: {msg_type}"})

    except WebSocketDisconnect:
        if train_task and not train_task.done():
            room.request_stop()


if __name__ == "__main__":
    import os
    import uvicorn

    # PORT is set by Railway in production; falls back to 8000 locally.
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, ws_ping_interval=20, ws_ping_timeout=120)
