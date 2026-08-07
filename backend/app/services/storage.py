import hashlib
import os
import uuid
from pathlib import Path
from typing import cast

import aiofiles  # type: ignore[import-untyped]
import filetype  # type: ignore[import-untyped]
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.schemas import FileValidation

SNIFF_BYTES = 4096
CHUNK_BYTES = 1024 * 1024


def _detect_mime(sample: bytes, declared: str | None) -> str:
    kind = filetype.guess(sample)
    if kind:
        detected = cast(str, kind.mime)
    elif declared in {"text/plain", "text/csv"}:
        try:
            sample.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "File content is not valid UTF-8 text"
            ) from exc
        detected = declared
    else:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Could not verify file type")
    if detected not in FileValidation.ALLOWED_MIMES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"File type {detected} is not allowed"
        )
    if declared and declared != detected:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Declared MIME type does not match file content"
        )
    return detected


async def persist_upload(
    upload: UploadFile, organization_id: uuid.UUID
) -> tuple[str, str, int, str, str]:
    try:
        original_name = FileValidation.clean_name(upload.filename)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    first = await upload.read(SNIFF_BYTES)
    if not first:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Empty files are not allowed")
    mime = _detect_mime(first, upload.content_type)
    suffix = Path(original_name).suffix.lower()[:12]
    storage_key = f"{organization_id}/{uuid.uuid4().hex}{suffix}"
    destination = settings.upload_dir / storage_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest, size = hashlib.sha256(), 0
    try:
        async with aiofiles.open(destination, "xb") as target:
            chunk = first
            while chunk:
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"File exceeds {settings.max_upload_bytes // 1048576} MB limit",
                    )
                digest.update(chunk)
                await target.write(chunk)
                chunk = await upload.read(CHUNK_BYTES)
    except Exception:
        if destination.exists():
            os.unlink(destination)
        raise
    finally:
        await upload.close()
    return storage_key, mime, size, digest.hexdigest(), original_name


def remove_upload(storage_key: str) -> None:
    target, root = (settings.upload_dir / storage_key).resolve(), settings.upload_dir.resolve()
    if root not in target.parents:
        raise ValueError("Unsafe storage key")
    target.unlink(missing_ok=True)
