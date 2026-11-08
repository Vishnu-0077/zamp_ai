import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEST_ROOT = ROOT / 'test_cases'

@dataclass
class Settings:
    db_path: Path = field(default_factory=lambda: Path(os.getenv('PROCESSING_DB', str(ROOT / 'backend' / 'runtime' / 'processing.sqlite3'))))
    inbox_path: Path = TEST_ROOT / 'test_inputs' / 'inbox.sqlite3'
    procurement_path: Path = field(default_factory=lambda: Path(os.getenv('PROCUREMENT_PATH', str(ROOT / 'backend' / 'procurement.json'))))
    api_key: str = field(default_factory=lambda: os.getenv('BACKEND_API_KEY', ''))
    reviewer_key: str = field(default_factory=lambda: os.getenv('REVIEWER_API_KEY', ''))
    model: str = field(default_factory=lambda: os.getenv('EXTRACTION_MODEL', ''))
    # Keys for providers named with a prefix, e.g. EXTRACTION_FALLBACK_MODELS=groq:openai/gpt-oss-120b.
    provider_keys: dict[str, str] = field(default_factory=lambda: {
        name: os.getenv(f'{name.upper()}_API_KEY', '') for name in ('gemini', 'groq')})
    base_url: str | None = field(default_factory=lambda: os.getenv('OPENAI_BASE_URL') or None)
    # Transient provider failures (429, 5xx, timeouts) only. Defaults keep a single attempt.
    fallback_models: list[str] = field(default_factory=lambda: [s.strip() for s in os.getenv('EXTRACTION_FALLBACK_MODELS', '').split(',') if s.strip()])
    provider_retries: int = field(default_factory=lambda: max(0, int(os.getenv('EXTRACTION_PROVIDER_RETRIES', '0'))))
    retry_backoff_seconds: float = field(default_factory=lambda: max(0.0, float(os.getenv('EXTRACTION_RETRY_BACKOFF_SECONDS', '2'))))
    cors_origins: list[str] = field(default_factory=lambda: [s for s in os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://localhost:5173').split(',') if s])
    max_pdf_bytes: int = 20 * 1024 * 1024
    max_pages: int = 30
    max_text_chars: int = 150000
    ocr_min_confidence: float = 85
    worker_enabled: bool = field(default_factory=lambda: os.getenv('WORKER_ENABLED', 'true').lower() == 'true')
    # Development only: wipe processed cases, audit and PO reservations when the worker starts.
    # The test inbox and procurement file are never touched.
    reset_on_start: bool = field(default_factory=lambda: os.getenv('RESET_ON_START', 'false').lower() == 'true')
