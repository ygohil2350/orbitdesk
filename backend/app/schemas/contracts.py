import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models import Priority, Role, TaskStatus

SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._ -]")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginRequest(StrictModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class OrgProvisionRequest(StrictModel):
    name: str = Field(min_length=2, max_length=100)
    slug: str = Field(pattern=r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", max_length=63)
    admin_email: EmailStr
    admin_name: str = Field(min_length=2, max_length=100)
    admin_password: str = Field(min_length=12, max_length=128)


class UserCreate(StrictModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=12, max_length=128)
    role: Role = Role.MEMBER

    @field_validator("role")
    @classmethod
    def only_member_role(cls, value: Role) -> Role:
        if value is not Role.MEMBER:
            raise ValueError("organization admins may only provision members")
        return value


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    full_name: str
    email: EmailStr
    role: Role


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    key: str
    description: str


class TaskCreate(StrictModel):
    project_id: uuid.UUID
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(default="", max_length=20_000)
    assignee_id: uuid.UUID
    priority: Priority = Priority.MEDIUM


class TaskMove(StrictModel):
    status: TaskStatus


class TaskUpdate(StrictModel):
    title: str | None = Field(default=None, min_length=3, max_length=160)
    description: str | None = Field(default=None, max_length=20_000)
    assignee_id: uuid.UUID | None = None
    priority: Priority | None = None

    @model_validator(mode="after")
    def require_change(self) -> "TaskUpdate":
        if (
            self.title is None
            and self.description is None
            and self.assignee_id is None
            and self.priority is None
        ):
            raise ValueError("at least one task field is required")
        return self


class CommentCreate(StrictModel):
    body: str = Field(min_length=1, max_length=4000)


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    body: str
    author: UserSummary
    attachments: list["AttachmentRead"] = []
    created_at: datetime


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    original_name: str
    mime_type: str
    size_bytes: int
    created_at: datetime


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    organization_id: uuid.UUID
    project_id: uuid.UUID
    sequence: int
    title: str
    description: str
    status: TaskStatus
    priority: Priority
    assignee: UserSummary
    reporter: UserSummary
    comments: list[CommentRead] = []
    attachments: list[AttachmentRead] = []
    created_at: datetime
    updated_at: datetime


class TaskListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    sequence: int
    title: str
    status: TaskStatus
    priority: Priority
    assignee: UserSummary
    updated_at: datetime


class PaginatedTasks(BaseModel):
    items: list[TaskListItem]
    total: int
    page: int
    page_size: int


class SessionRead(BaseModel):
    user: UserSummary
    organization_id: uuid.UUID | None
    organization_name: str | None


class FileValidation:
    ALLOWED_MIMES = {
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/csv",
        "application/zip",
    }

    @classmethod
    def clean_name(cls, filename: str | None) -> str:
        if not filename:
            raise ValueError("file name is required")
        cleaned = SAFE_FILENAME.sub("_", filename).strip(" .")
        if not cleaned or len(cleaned) > 255:
            raise ValueError("invalid file name")
        return cleaned
