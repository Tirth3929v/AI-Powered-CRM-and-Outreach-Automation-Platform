"""
FastAPI Main Application Entrypoint.
Initializes middleware, routers, and lifecycle events.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.core.config import get_settings
from backend.app.core.logging import CorrelationIdMiddleware, setup_logging
from backend.app.api.v1.health import router as health_router
from backend.app.api.v1.auth import router as auth_router
from backend.app.api.v1.leads import router as leads_router
from backend.app.api.v1.lead_status import router as lead_status_router
from backend.app.api.v1.enrichment import router as enrichment_router
from backend.app.api.v1.verification import router as verification_router
from backend.app.api.v1.campaigns import router as campaigns_router
from backend.app.api.v1.approvals import router as approvals_router
from backend.app.api.v1.suppression import router as suppression_router
from backend.app.api.v1.webhooks import router as webhooks_router
from backend.app.api.v1.error_center import router as error_center_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup actions
    setup_logging()
    yield
    # Shutdown actions


def create_application() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="AI-Powered Lead Intelligence, CRM & Outreach Automation API",
        description="Unified backend platform orchestrating CRM pipeline, AI drafts, and controlled outreach.",
        version=settings.APP_VERSION,
        lifespan=lifespan
    )

    # Correlation ID Middleware (Adds X-Correlation-ID to all responses)
    app.add_middleware(CorrelationIdMiddleware)

    # CORS Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Correlation-ID"]
    )

    # Mount API v1 Routers
    api_v1_prefix = "/api/v1"
    app.include_router(health_router, prefix=api_v1_prefix)
    app.include_router(auth_router, prefix=api_v1_prefix)
    app.include_router(leads_router, prefix=api_v1_prefix)
    app.include_router(lead_status_router, prefix=api_v1_prefix)
    app.include_router(enrichment_router, prefix=api_v1_prefix)
    app.include_router(verification_router, prefix=api_v1_prefix)
    app.include_router(campaigns_router, prefix=api_v1_prefix)
    app.include_router(approvals_router, prefix=api_v1_prefix)
    app.include_router(suppression_router, prefix=api_v1_prefix)
    app.include_router(webhooks_router, prefix=api_v1_prefix)
    app.include_router(error_center_router, prefix=api_v1_prefix)

    # Root redirect / health convenience
    @app.get("/", tags=["Root"])
    def root():
        return {
            "name": "AI CRM & Outreach Automation API",
            "version": settings.APP_VERSION,
            "docs": "/docs",
            "health": f"{api_v1_prefix}/health"
        }

    return app


app = create_application()
