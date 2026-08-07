import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Comment, Task, TaskStatus, User

ALLOWED_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.TODO: {TaskStatus.IN_PROGRESS},
    TaskStatus.IN_PROGRESS: {TaskStatus.TODO, TaskStatus.DONE},
    TaskStatus.DONE: {TaskStatus.IN_PROGRESS},
}


async def get_tenant_task(
    session: AsyncSession, task_id: uuid.UUID, organization_id: uuid.UUID, *, detailed: bool = False
) -> Task:
    query = select(Task).where(Task.id == task_id, Task.organization_id == organization_id)
    if detailed:
        query = query.options(
            selectinload(Task.assignee),
            selectinload(Task.reporter),
            selectinload(Task.comments).selectinload(Comment.author),
            selectinload(Task.comments).selectinload(Comment.attachments),
            selectinload(Task.attachments),
        )
    task = (await session.execute(query)).scalar_one_or_none()
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task


async def get_tenant_user(
    session: AsyncSession, user_id: uuid.UUID, organization_id: uuid.UUID
) -> User:
    user = (
        await session.execute(
            select(User).where(
                User.id == user_id,
                User.organization_id == organization_id,
                User.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Assignee is not in your organization"
        )
    return user


def validate_transition(current: TaskStatus, requested: TaskStatus) -> None:
    if current != requested and requested not in ALLOWED_TRANSITIONS[current]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Invalid workflow transition: {current.value} -> {requested.value}",
        )
