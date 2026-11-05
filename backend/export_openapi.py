"""Export API contracts without starting the worker or calling a model."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.main import app

path = ROOT / 'backend' / 'openapi.json'
path.write_text(json.dumps(app.openapi(), indent=2) + '\n')
print(path)
