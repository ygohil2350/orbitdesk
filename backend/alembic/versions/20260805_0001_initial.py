"""Initial tenant-safe schema.

Revision ID: 20260805_0001
"""

from collections.abc import Sequence

from alembic import op
from app.models import Base

revision: str = "20260805_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The declarative metadata is the canonical schema and includes composite tenant FKs,
    # checks, and PostgreSQL's partial unique index for the single super user invariant.
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
