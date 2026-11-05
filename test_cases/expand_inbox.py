"""Compatibility entry point: the generator now creates the complete 50-email set."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_cases.generate_inbox import generate

if __name__ == '__main__':
    generate()
