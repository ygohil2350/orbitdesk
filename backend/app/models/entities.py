import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Role(str, enum.Enum):
    SUPERUSER = "superuser"
    ORG_ADMIN = "org_admin"
    MEMBER = "member"


class TaskStatus(str, enum.Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class Priority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(63), unique=True, nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="organization")
    projects: Mapped[list["Project"]] = relationship(back_populates="organization")


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("id", "organization_id", name="uq_users_id_org"),
        CheckConstraint(
            "(role = 'superuser' AND organization_id IS NULL) OR "
            "(role <> 'superuser' AND organization_id IS NOT NULL)",
            name="ck_user_role_tenant",
        ),
        Index(
            "uq_single_system_superuser",
            "role",
            unique=True,
            postgresql_where=text("role = 'superuser'"),
        ),
        Index("ix_users_org_role", "organization_id", "role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="role", values_callable=lambda x: [e.value for e in x])
    )
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    organization: Mapped[Organization | None] = relationship(back_populates="users")

    @property
    def is_superuser(self) -> bool:
        return self.role is Role.SUPERUSER


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("id", "organization_id", name="uq_projects_id_org"),
        UniqueConstraint("organization_id", "key", name="uq_projects_org_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key: Mapped[str] = mapped_column(String(8), nullable=False)
    description: Mapped[str] = mapped_column(String(500), default="", nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="projects")
    tasks: Mapped[list["Task"]] = relationship(back_populates="project")


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("id", "organization_id", name="uq_tasks_id_org"),
        ForeignKeyConstraint(
            ["project_id", "organization_id"],
            ["projects.id", "projects.organization_id"],
            ondelete="CASCADE",
            name="fk_task_project_tenant",
        ),
        ForeignKeyConstraint(
            ["assignee_id", "organization_id"],
            ["users.id", "users.organization_id"],
            ondelete="RESTRICT",
            name="fk_task_assignee_tenant",
        ),
        ForeignKeyConstraint(
            ["reporter_id", "organization_id"],
            ["users.id", "users.organization_id"],
            ondelete="RESTRICT",
            name="fk_task_reporter_tenant",
        ),
        Index("ix_tasks_org_status", "organization_id", "status"),
        Index("ix_tasks_project_status", "project_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status", values_callable=lambda x: [e.value for e in x]),
        default=TaskStatus.TODO,
    )
    priority: Mapped[Priority] = mapped_column(
        Enum(Priority, name="priority", values_callable=lambda x: [e.value for e in x]),
        default=Priority.MEDIUM,
    )
    assignee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reporter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    project: Mapped[Project] = relationship(back_populates="tasks")
    assignee: Mapped[User] = relationship(foreign_keys=[assignee_id])
    reporter: Mapped[User] = relationship(foreign_keys=[reporter_id])
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="Comment.created_at"
    )
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="task", overlaps="attachments,comment"
    )


class Comment(Base, TimestampMixin):
    __tablename__ = "comments"
    __table_args__ = (
        UniqueConstraint("id", "organization_id", name="uq_comments_id_org"),
        ForeignKeyConstraint(
            ["task_id", "organization_id"],
            ["tasks.id", "tasks.organization_id"],
            ondelete="CASCADE",
            name="fk_comment_task_tenant",
        ),
        ForeignKeyConstraint(
            ["author_id", "organization_id"],
            ["users.id", "users.organization_id"],
            ondelete="RESTRICT",
            name="fk_comment_author_tenant",
        ),
        Index("ix_comments_task_created", "task_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(String(4000), nullable=False)

    task: Mapped[Task] = relationship(back_populates="comments")
    author: Mapped[User] = relationship(foreign_keys=[author_id])
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="comment", overlaps="attachments,task"
    )


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "organization_id"],
            ["tasks.id", "tasks.organization_id"],
            ondelete="CASCADE",
            name="fk_attachment_task_tenant",
        ),
        ForeignKeyConstraint(
            ["comment_id", "organization_id"],
            ["comments.id", "comments.organization_id"],
            ondelete="CASCADE",
            name="fk_attachment_comment_tenant",
        ),
        ForeignKeyConstraint(
            ["uploader_id", "organization_id"],
            ["users.id", "users.organization_id"],
            ondelete="RESTRICT",
            name="fk_attachment_uploader_tenant",
        ),
        CheckConstraint(
            "(task_id IS NOT NULL AND comment_id IS NULL) OR "
            "(task_id IS NULL AND comment_id IS NOT NULL)",
            name="ck_attachment_exactly_one_parent",
        ),
        Index("ix_attachments_org", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    comment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    uploader_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped[Task | None] = relationship(
        back_populates="attachments", overlaps="attachments,comment"
    )
    comment: Mapped[Comment | None] = relationship(
        back_populates="attachments", overlaps="attachments,task"
    )
    uploader: Mapped[User] = relationship(foreign_keys=[uploader_id])
