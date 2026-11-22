
"""
FastAPI Main Application Entrypoint.
Initializes middleware, routers, and centralized error handling.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.app.core.config import get_settings
from backend.app.core.logging import CorrelationIdMiddleware, setup_logging
from backend.app.api.v1.health import router as health_router
from backend.app.api.v1.auth import router as auth_router
from backend.app.api.v1.leads import router as leads_router
from backend.app.api.v1.enrichment import router as enrichment_router
from backend.app.api.v1.verification import router as verification_router
from backend.app.api.v1.campaigns import router as campaigns_router
from backend.app.api.v1.approvals import router as approvals_router
from backend.app.api.v1.suppression import router as suppression_router
from backend.app.api.v1.webhooks import router as webhooks_router
from backend.app.api.v1.error_center import router as error_center_router

logger = logging.getLogger(__name__)


def error_response(
    status_code: int,
    code: str,
    message: str,
    correlation_id: str | None,
):
    """Create an error response matching the OpenAPI ErrorResponse schema."""
    body = {
        "status": status_code,
        "code": code,
        "message": message,
    }

    if correlation_id:
        body["correlation_id"] = correlation_id

    return JSONResponse(status_code=status_code, content=body)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    yield


def create_application() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="AI-Powered Lead Intelligence, CRM & Outreach Automation API",
        description="Unified backend platform orchestrating CRM pipeline, AI drafts, and controlled outreach.",
        version=settings.APP_VERSION,
        lifespan=lifespan,
    )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request,
        exc: RequestValidationError,
    ):
        """Return a safe, consistent response for invalid request data."""
        return error_response(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Request validation failed. Please check the supplied data.",
            correlation_id=getattr(request.state, "correlation_id", None),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request,
        exc: StarletteHTTPException,
    ):
        """Convert HTTP errors into the standard API error format."""
        correlation_id = getattr(request.state, "correlation_id", None)

        if isinstance(exc.detail, dict):
            code = exc.detail.get("code", "HTTP_ERROR")
            message = exc.detail.get("message", "The request could not be completed.")
            correlation_id = exc.detail.get("correlation_id") or correlation_id
        else:
            code_by_status = {
                400: "BAD_REQUEST",
                401: "UNAUTHORIZED",
                403: "FORBIDDEN",
                404: "RESOURCE_NOT_FOUND",
                409: "RESOURCE_CONFLICT",
                422: "VALIDATION_ERROR",
            }
            code = code_by_status.get(exc.status_code, "HTTP_ERROR")
            message = (
                exc.detail
                if isinstance(exc.detail, str)
                else "The request could not be completed."
            )

        return error_response(
            status_code=exc.status_code,
            code=code,
            message=message,
            correlation_id=correlation_id,
        )

    @app.exception_handler(Exception)
    async def unexpected_exception_handler(
        request: Request,
        exc: Exception,
    ):
        """Log unexpected errors internally without exposing technical details."""
        correlation_id = getattr(request.state, "correlation_id", None)

        logger.exception(
            "Unexpected application error",
            extra={"correlation_id": correlation_id},
        )

        return error_response(
            status_code=500,
            code="INTERNAL_SERVER_ERROR",
            message="An unexpected server error occurred. Please try again later.",
            correlation_id=correlation_id,
        )

    app.add_middleware(CorrelationIdMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Correlation-ID"],
    )

    api_v1_prefix = "/api/v1"
    app.include_router(health_router, prefix=api_v1_prefix)
    app.include_router(auth_router, prefix=api_v1_prefix)
    app.include_router(leads_router, prefix=api_v1_prefix)
    app.include_router(enrichment_router, prefix=api_v1_prefix)
    app.include_router(verification_router, prefix=api_v1_prefix)
    app.include_router(campaigns_router, prefix=api_v1_prefix)
    app.include_router(approvals_router, prefix=api_v1_prefix)
    app.include_router(suppression_router, prefix=api_v1_prefix)
    app.include_router(webhooks_router, prefix=api_v1_prefix)
    app.include_router(error_center_router, prefix=api_v1_prefix)

    @app.get("/", tags=["Root"])
    def root():
        return {
            "name": "AI CRM & Outreach Automation API",
            "version": settings.APP_VERSION,
            "docs": "/docs",
            "health": f"{api_v1_prefix}/health",
        }

    return app


app = create_application()
