"""Run real PDF/OCR/model extraction in isolation; compare labels only afterward.

Run with provider environment variables exported:
  python -m backend.audit_inbox --output /tmp/invoice-audit --workers 3
Cached extraction permits rules-only reruns without more provider requests.
"""
import argparse
import json
import sqlite3
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from .settings import Settings, TEST_ROOT
from .invoice_extractor import parse_pdf, LangChainExtractor
from .invoice_service import Service
from .schemas import ExtractionBatch


def run(output, workers, repair_cached=False):
    if (output / 'processing.sqlite3').resolve() == Settings().db_path.resolve():
        raise ValueError('Audit output must use a separate database from the application.')
    if output.resolve().is_relative_to(TEST_ROOT.resolve()):
        raise ValueError('Audit output cannot modify test_cases.')
    output.mkdir(parents=True, exist_ok=True)
    settings = Settings(db_path=output / 'processing.sqlite3', worker_enabled=False,
                        reset_on_start=False, provider_retries=0)
    with sqlite3.connect(f'file:{settings.inbox_path}?mode=ro', uri=True) as c:
        inputs = [(i, TEST_ROOT / path) for i, path in c.execute('SELECT id,attachment_path FROM emails ORDER BY id')]
    def extract(item):
        i, path = item
        cache = output / f'{i}.json'
        if cache.exists():
            cached = json.loads(cache.read_text())
            if not repair_cached:
                return cached
            if 'batch' in cached:
                extractor = LangChainExtractor(settings)
                extractor.last_model = cached['model']
                batch = extractor.repair_evidence(ExtractionBatch.model_validate(cached['batch']), cached['pages'])
                cached.update(batch=batch.model_dump(mode='json'), model=extractor.last_model)
                cache.write_text(json.dumps(cached, indent=2))
                return cached
        try:
            pages = parse_pdf(path.read_bytes(), settings)
            extractor = LangChainExtractor(settings)
            batch = extractor.extract(pages)
            batch = extractor.repair_evidence(batch, pages)
            result = {'pages': pages, 'batch': batch.model_dump(mode='json'), 'model': extractor.last_model}
        except Exception as exc:
            result = {'error': type(exc).__name__, 'message': str(exc)}
        cache.write_text(json.dumps(result, indent=2))
        print(f'Extracted {i}: {result.get("error", "ok")}', flush=True)
        return result
    # Identical email 41 shares email 1's extraction; ingestion handles idempotency.
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {i: pool.submit(extract, (i, path)) for i, path in inputs if i != 41}
        futures[41] = futures[1]
        service = Service(settings)
        service.store.reset()
        results = []
        for i, path in inputs:
            raw = futures[i].result()
            ingested = service.ingest_email(i)
            if not ingested['duplicate_submission']:
                if 'error' in raw:
                    service.fail(ingested['id'], 'PROCESSING_ERROR', raw['message'])
                else:
                    class Cached:
                        last_model = raw['model']
                        def extract(self, pages):
                            return ExtractionBatch.model_validate(raw['batch'])
                    service.extractor = Cached()
                    with patch('backend.invoice_service.parse_pdf', return_value=raw['pages']):
                        service.process_next()
            case = service.store.get(ingested['id'])
            row = {'email_id': i, 'status': 'duplicate' if ingested['duplicate_submission'] else case['status'],
                   'case_id': case['id'], 'findings': case['findings'], 'model': case['model']}
            results.append(row)
            (output / 'results.json').write_text(json.dumps(results, indent=2))
            print(f'Email {i}: {row["status"]} {[f["code"] for f in row["findings"]]}', flush=True)
    # Labels only measure predictions; they never reach parsing/extraction/decision code.
    labels = json.loads((TEST_ROOT / 'test_inputs/ground_truth/expected.json').read_text())
    expected = {r['id']: {'approve':'approved', 'human_review':'review', 'duplicate':'duplicate'}[r['expected']] for r in labels}
    report = {'counts': dict(Counter(r['status'] for r in results)),
              'mismatches': [dict(r, expected=expected[r['email_id']]) for r in results if r['status'] != expected[r['email_id']]],
              'results': results}
    (output / 'report.json').write_text(json.dumps(report, indent=2))
    print('TOTALS', report['counts'], 'MISMATCHES', len(report['mismatches']), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--repair-cached', action='store_true', help='Retry provider failures and repair cached unsupported evidence from source')
    args = parser.parse_args()
    run(args.output, args.workers, args.repair_cached)
