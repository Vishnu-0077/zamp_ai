import type { PageText } from '@/api/types';
import { Badge, Empty } from '@/components';

export function PagesView({ pages }: { pages: PageText[] | null | undefined }) {
  if (!pages?.length) return <Empty>No parsed page text is available.</Empty>;
  return (
    <div className="stack">
      {pages.map((p) => (
        <section key={p.page} className="card" style={{ margin: 0 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <strong>Page {p.page}</strong>
            <Badge tone={p.route === 'ocr' ? 'info' : 'neutral'}>{p.route}</Badge>
            {p.ocr_confidence != null && (
              <Badge tone={p.ocr_confidence >= 85 ? 'ok' : 'danger'}>OCR confidence {p.ocr_confidence.toFixed(1)}</Badge>
            )}
          </div>
          <pre className="json">{p.text || '(no text)'}</pre>
        </section>
      ))}
    </div>
  );
}
