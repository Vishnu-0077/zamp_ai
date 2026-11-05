"""Application entry point: uvicorn backend.main:app."""
from fastapi import FastAPI
from .processing_api import install
from .inbox_api import router as inbox_router

app = FastAPI(
    title="Invoice Processing API",
    version="1.0.0",
    description="Invoice ingestion, extraction, deterministic validation and human review.",
)
app.include_router(inbox_router)
install(app)
