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
    base_url: str | None = field(default_factory=lambda: os.getenv('OPENAI_BASE_URL') or None)
    cors_origins: list[str] = field(default_factory=lambda: [s for s in os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://localhost:5173').split(',') if s])
    max_pdf_bytes: int = 20 * 1024 * 1024
    max_pages: int = 30
    max_text_chars: int = 150000
    ocr_min_confidence: float = 85
    worker_enabled: bool = field(default_factory=lambda: os.getenv('WORKER_ENABLED', 'true').lower() == 'true')
