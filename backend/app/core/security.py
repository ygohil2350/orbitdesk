import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: uuid.UUID, token_version: int) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "ver": token_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_ttl_minutes),
        "aud": "orbitdesk-api",
        "iss": "orbitdesk",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> tuple[uuid.UUID, int]:
    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[ALGORITHM],
        audience="orbitdesk-api",
        issuer="orbitdesk",
    )
    return uuid.UUID(payload["sub"]), int(payload["ver"])
