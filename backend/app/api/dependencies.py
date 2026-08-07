import uuid
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import get_session
from app.models import Role, User

bearer = HTTPBearer(auto_error=False)
DbSession = Annotated[AsyncSession, Depends(get_session)]


async def user_from_token(token: str, session: AsyncSession) -> User | None:
    try:
        user_id, version = decode_access_token(token)
    except (jwt.PyJWTError, ValueError, KeyError):
        return None
    user = await session.get(User, user_id)
    if not user or not user.is_active or user.token_version != version:
        return None
    return user


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: DbSession,
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    user = await user_from_token(credentials.credentials, session)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: Role) -> Callable[..., Coroutine[Any, Any, User]]:
    async def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return dependency


async def require_tenant_user(user: CurrentUser) -> User:
    if user.organization_id is None or user.role is Role.SUPERUSER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Organization membership required")
    return user


TenantUser = Annotated[User, Depends(require_tenant_user)]


def tenant_id(user: User) -> uuid.UUID:
    if user.organization_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Organization membership required")
    return user.organization_id
