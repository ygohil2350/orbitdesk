import uuid

import jwt
import pytest

from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_password_hash_round_trip() -> None:
    hashed = hash_password("LongDemoPassword1!")
    assert hashed != "LongDemoPassword1!"
    assert verify_password("LongDemoPassword1!", hashed)
    assert not verify_password("wrong-password", hashed)


def test_jwt_binds_user_and_token_version() -> None:
    user_id = uuid.uuid4()
    token = create_access_token(user_id, 7)
    assert decode_access_token(token) == (user_id, 7)


def test_tampered_jwt_is_rejected() -> None:
    token = create_access_token(uuid.uuid4(), 0)
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(token + "tampered")
