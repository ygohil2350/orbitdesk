import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.api import router
from app.core.config import settings
from app.core.middleware import RequestSizeLimitMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = FastAPI(title=settings.app_name, version="1.0.0", docs_url="/api/docs", redoc_url=None)
app.include_router(router, prefix="/api/v1")
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=settings.max_upload_bytes + 1024 * 1024)

if settings.cors_origin:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.cors_origin],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.status_code, "message": exc.detail}},
    )


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = [
        {"field": ".".join(str(x) for x in item["loc"][1:]), "message": item["msg"]}
        for item in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={"error": {"code": 422, "message": "Validation failed", "details": details}},
    )
