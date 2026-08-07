import asyncio
import uuid
from collections import defaultdict

from fastapi import WebSocket


class TaskRoomManager:
    """Process-local rooms. A Redis adapter is only needed for multiple API replicas."""

    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def join(self, task_id: uuid.UUID, socket: WebSocket) -> None:
        async with self._lock:
            self._rooms[task_id].add(socket)

    async def leave(self, task_id: uuid.UUID, socket: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(task_id)
            if room:
                room.discard(socket)
                if not room:
                    self._rooms.pop(task_id, None)

    async def broadcast(self, task_id: uuid.UUID, payload: dict[str, object]) -> None:
        async with self._lock:
            recipients = list(self._rooms.get(task_id, set()))
        stale: list[WebSocket] = []
        for socket in recipients:
            try:
                await socket.send_json(payload)
            except Exception:
                stale.append(socket)
        for socket in stale:
            await self.leave(task_id, socket)


rooms = TaskRoomManager()
