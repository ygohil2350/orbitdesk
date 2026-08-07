import asyncio
import logging
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.dependencies import (
    CurrentUser,
    DbSession,
    TenantUser,
    require_role,
    tenant_id,
    user_from_token,
)
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import SessionLocal, engine
from app.models import Attachment, Comment, Organization, Project, Role, Task, TaskStatus, User
from app.schemas import (
    AttachmentRead,
    CommentCreate,
    CommentRead,
    LoginRequest,
    OrgProvisionRequest,
    PaginatedTasks,
    ProjectRead,
    SessionRead,
    TaskCreate,
    TaskListItem,
    TaskMove,
    TaskRead,
    TaskUpdate,
    TokenResponse,
    UserCreate,
    UserSummary,
)
from app.services.realtime import rooms
from app.services.storage import persist_upload, remove_upload
from app.services.tasks import get_tenant_task, get_tenant_user, validate_transition

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    async with engine.connect() as connection:
        await connection.execute(select(1))
    return {"status": "ok", "database": "ready"}


@router.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: DbSession) -> TokenResponse:
    user = (
        await session.execute(
            select(User).where(
                func.lower(User.email) == payload.email.lower(), User.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return TokenResponse(access_token=create_access_token(user.id, user.token_version))


@router.get("/auth/me", response_model=SessionRead)
async def me(user: CurrentUser, session: DbSession) -> SessionRead:
    organization = (
        await session.get(Organization, user.organization_id) if user.organization_id else None
    )
    return SessionRead(
        user=UserSummary.model_validate(user),
        organization_id=user.organization_id,
        organization_name=organization.name if organization else None,
    )


@router.post("/admin/organizations", status_code=201)
async def provision_organization(
    payload: OrgProvisionRequest,
    session: DbSession,
    _: Annotated[User, Depends(require_role(Role.SUPERUSER))],
) -> dict[str, object]:
    organization = Organization(name=payload.name, slug=payload.slug)
    session.add(organization)
    await session.flush()
    admin = User(
        organization_id=organization.id,
        email=payload.admin_email.lower(),
        full_name=payload.admin_name,
        password_hash=hash_password(payload.admin_password),
        role=Role.ORG_ADMIN,
    )
    project = Project(
        organization_id=organization.id,
        name="First project",
        key="FIRST",
        description="Your team's first workspace",
    )
    session.add_all([admin, project])
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Organization slug, name, or admin email already exists"
        ) from exc
    return {
        "id": organization.id,
        "name": organization.name,
        "slug": organization.slug,
        "admin": UserSummary.model_validate(admin),
    }


@router.post("/members", response_model=UserSummary, status_code=201)
async def create_member(
    payload: UserCreate,
    session: DbSession,
    admin: Annotated[User, Depends(require_role(Role.ORG_ADMIN))],
) -> User:
    member = User(
        organization_id=tenant_id(admin),
        email=payload.email.lower(),
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=Role.MEMBER,
    )
    session.add(member)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Email address is already registered"
        ) from exc
    return member


@router.get("/members", response_model=list[UserSummary])
async def list_members(session: DbSession, user: TenantUser) -> list[User]:
    return list(
        (
            await session.scalars(
                select(User)
                .where(User.organization_id == tenant_id(user), User.is_active.is_(True))
                .order_by(User.full_name)
            )
        ).all()
    )


@router.get("/projects", response_model=list[ProjectRead])
async def list_projects(session: DbSession, user: TenantUser) -> list[Project]:
    return list(
        (
            await session.scalars(
                select(Project)
                .where(Project.organization_id == tenant_id(user))
                .order_by(Project.name)
            )
        ).all()
    )


@router.get("/tasks", response_model=PaginatedTasks)
async def list_tasks(
    session: DbSession,
    user: TenantUser,
    project_id: uuid.UUID | None = None,
    task_status: Annotated[TaskStatus | None, Query(alias="status")] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> PaginatedTasks:
    conditions = [Task.organization_id == tenant_id(user)]
    if project_id:
        conditions.append(Task.project_id == project_id)
    if task_status:
        conditions.append(Task.status == task_status)
    if search:
        conditions.append(Task.title.ilike(f"%{search}%"))
    total = await session.scalar(select(func.count(Task.id)).where(*conditions)) or 0
    query = (
        select(Task)
        .where(*conditions)
        .options(selectinload(Task.assignee))
        .order_by(Task.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    tasks = list((await session.scalars(query)).all())
    return PaginatedTasks(
        items=[TaskListItem.model_validate(task) for task in tasks],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/tasks", response_model=TaskRead, status_code=201)
async def create_task(payload: TaskCreate, session: DbSession, user: TenantUser) -> Task:
    org_id = tenant_id(user)
    project = (
        await session.execute(
            select(Project)
            .where(Project.id == payload.project_id, Project.organization_id == org_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Project is not in your organization"
        )
    await get_tenant_user(session, payload.assignee_id, org_id)
    sequence = (
        await session.scalar(select(func.max(Task.sequence)).where(Task.project_id == project.id))
    ) or 0
    task = Task(
        organization_id=org_id,
        project_id=project.id,
        sequence=sequence + 1,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        assignee_id=payload.assignee_id,
        reporter_id=user.id,
    )
    session.add(task)
    await session.commit()
    return await get_tenant_task(session, task.id, org_id, detailed=True)


@router.get("/tasks/{task_id}", response_model=TaskRead)
async def read_task(task_id: uuid.UUID, session: DbSession, user: TenantUser) -> Task:
    return await get_tenant_task(session, task_id, tenant_id(user), detailed=True)


@router.patch("/tasks/{task_id}", response_model=TaskRead)
async def update_task(
    task_id: uuid.UUID, payload: TaskUpdate, session: DbSession, user: TenantUser
) -> Task:
    task = await get_tenant_task(session, task_id, tenant_id(user))
    if payload.title is not None:
        task.title = payload.title
    if payload.description is not None:
        task.description = payload.description
    if payload.assignee_id is not None:
        # Resolve through the current tenant before assigning. The composite tenant
        # foreign key remains a second line of defense against cross-org references.
        await get_tenant_user(session, payload.assignee_id, tenant_id(user))
        task.assignee_id = payload.assignee_id
    if payload.priority is not None:
        task.priority = payload.priority
    await session.commit()
    return await get_tenant_task(session, task.id, tenant_id(user), detailed=True)


@router.patch("/tasks/{task_id}/status", response_model=TaskRead)
async def move_task(
    task_id: uuid.UUID, payload: TaskMove, session: DbSession, user: TenantUser
) -> Task:
    task = await get_tenant_task(session, task_id, tenant_id(user))
    previous_status = task.status
    validate_transition(task.status, payload.status)
    task.status = payload.status
    await session.commit()
    updated = await get_tenant_task(session, task.id, tenant_id(user), detailed=True)
    if previous_status != payload.status:
        await rooms.broadcast(
            task_id,
            {
                "type": "task.status.changed",
                "actor": {"id": str(user.id), "full_name": user.full_name},
                "from": previous_status.value,
                "to": payload.status.value,
            },
        )
    return updated


def _comment_payload(comment: Comment, author: User) -> dict[str, object]:
    return {
        "type": "comment.created",
        "comment": {
            "id": str(comment.id),
            "body": comment.body,
            "author": {
                "id": str(author.id),
                "full_name": author.full_name,
                "email": author.email,
                "role": author.role.value,
            },
            "created_at": comment.created_at.isoformat(),
            "attachments": [],
        },
    }


@router.post("/tasks/{task_id}/comments", response_model=CommentRead, status_code=201)
async def create_comment(
    task_id: uuid.UUID, payload: CommentCreate, session: DbSession, user: TenantUser
) -> Comment:
    org_id = tenant_id(user)
    await get_tenant_task(session, task_id, org_id)
    comment = Comment(organization_id=org_id, task_id=task_id, author_id=user.id, body=payload.body)
    comment.author = user
    session.add(comment)
    await session.commit()
    await rooms.broadcast(task_id, _comment_payload(comment, user))
    return comment


async def _save_attachment(
    upload: UploadFile,
    *,
    task_id: uuid.UUID | None,
    comment_id: uuid.UUID | None,
    session: DbSession,
    user: User,
) -> Attachment:
    org_id = tenant_id(user)
    if task_id:
        await get_tenant_task(session, task_id, org_id)
    if comment_id:
        comment = (
            await session.execute(
                select(Comment).where(Comment.id == comment_id, Comment.organization_id == org_id)
            )
        ).scalar_one_or_none()
        if not comment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    key, mime, size, digest, name = await persist_upload(upload, org_id)
    attachment = Attachment(
        organization_id=org_id,
        task_id=task_id,
        comment_id=comment_id,
        uploader_id=user.id,
        original_name=name,
        storage_key=key,
        mime_type=mime,
        size_bytes=size,
        sha256=digest,
    )
    session.add(attachment)
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        remove_upload(key)
        raise
    return attachment


@router.post("/tasks/{task_id}/attachments", response_model=AttachmentRead, status_code=201)
async def upload_task_attachment(
    task_id: uuid.UUID, session: DbSession, user: TenantUser, file: Annotated[UploadFile, File(...)]
) -> Attachment:
    return await _save_attachment(
        file, task_id=task_id, comment_id=None, session=session, user=user
    )


@router.post("/comments/{comment_id}/attachments", response_model=AttachmentRead, status_code=201)
async def upload_comment_attachment(
    comment_id: uuid.UUID,
    session: DbSession,
    user: TenantUser,
    file: Annotated[UploadFile, File(...)],
) -> Attachment:
    comment = (
        await session.execute(
            select(Comment).where(
                Comment.id == comment_id,
                Comment.organization_id == tenant_id(user),
            )
        )
    ).scalar_one_or_none()
    if not comment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    attachment = await _save_attachment(
        file, task_id=None, comment_id=comment_id, session=session, user=user
    )
    await rooms.broadcast(
        comment.task_id,
        {
            "type": "comment.attachment.created",
            "comment_id": str(comment_id),
            "attachment": AttachmentRead.model_validate(attachment).model_dump(mode="json"),
        },
    )
    return attachment


@router.get("/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: uuid.UUID, session: DbSession, user: TenantUser
) -> FileResponse:
    attachment = (
        await session.execute(
            select(Attachment).where(
                Attachment.id == attachment_id, Attachment.organization_id == tenant_id(user)
            )
        )
    ).scalar_one_or_none()
    if not attachment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    path = (settings.upload_dir / attachment.storage_key).resolve()
    if settings.upload_dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment content not found")
    return FileResponse(
        Path(path), media_type=attachment.mime_type, filename=attachment.original_name
    )


@router.websocket("/ws/tasks/{task_id}")
async def task_socket(socket: WebSocket, task_id: uuid.UUID) -> None:
    await socket.accept()
    joined = False
    try:
        auth = await asyncio.wait_for(socket.receive_json(), timeout=8)
        if (
            not isinstance(auth, dict)
            or auth.get("type") != "auth"
            or not isinstance(auth.get("token"), str)
        ):
            await socket.close(code=4401, reason="Authentication required")
            return
        async with SessionLocal() as session:
            user = await user_from_token(auth["token"], session)
            if not user or not user.organization_id or user.role is Role.SUPERUSER:
                await socket.close(code=4403, reason="Organization membership required")
                return
            try:
                await get_tenant_task(session, task_id, user.organization_id)
            except HTTPException:
                await socket.close(code=4404, reason="Task not found")
                return
            await rooms.join(task_id, socket)
            joined = True
            await socket.send_json({"type": "ready"})
            while True:
                raw = await socket.receive_json()
                if not isinstance(raw, dict) or raw.get("type") != "comment.create":
                    await socket.send_json({"type": "error", "message": "Unsupported message"})
                    continue
                try:
                    payload = CommentCreate.model_validate({"body": raw.get("body")})
                except ValidationError as exc:
                    await socket.send_json({"type": "error", "message": exc.errors()[0]["msg"]})
                    continue
                comment = Comment(
                    organization_id=user.organization_id,
                    task_id=task_id,
                    author_id=user.id,
                    body=payload.body,
                )
                session.add(comment)
                await session.commit()
                await rooms.broadcast(task_id, _comment_payload(comment, user))
    except (TimeoutError, WebSocketDisconnect):
        pass
    except Exception:
        log.exception("Task WebSocket failed", extra={"task_id": str(task_id)})
        try:
            await socket.close(code=1011)
        except RuntimeError:
            pass
    finally:
        if joined:
            await rooms.leave(task_id, socket)
