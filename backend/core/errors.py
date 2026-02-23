"""
Custom exceptions and FastAPI error-handling middleware.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


log = logging.getLogger(__name__)


# ─── Custom Exceptions ───────────────────────────────────────────────────────

class AppError(Exception):
    """Base application error."""

    def __init__(self, message: str, status_code: int = 500, detail: Any = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.detail = detail


class NotFoundError(AppError):
    def __init__(self, resource: str = "Resource", detail: Any = None):
        super().__init__(f"{resource} not found", status_code=404, detail=detail)


class IntegrationError(AppError):
    def __init__(self, provider: str, message: str, detail: Any = None):
        super().__init__(f"{provider} error: {message}", status_code=502, detail=detail)


class AIServiceError(AppError):
    def __init__(self, message: str = "AI service error", detail: Any = None):
        super().__init__(message, status_code=503, detail=detail)


class ValidationError(AppError):
    def __init__(self, message: str, detail: Any = None):
        super().__init__(message, status_code=400, detail=detail)


# ─── Error Handlers ──────────────────────────────────────────────────────────

def register_error_handlers(app: FastAPI) -> None:
    """Register custom exception handlers on the FastAPI app."""

    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        log.warning("AppError [%d]: %s", exc.status_code, exc.message)
        body: dict[str, Any] = {"error": exc.message}
        if exc.detail is not None:
            body["detail"] = exc.detail
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(Exception)
    async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error"},
        )
