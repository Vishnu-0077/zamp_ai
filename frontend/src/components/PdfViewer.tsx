export function PdfViewer({ src, title = 'Invoice PDF' }: { src: string; title?: string }) {
  return (
    <div className="stack">
      <div className="row">
        <span className="muted small">Source document</span>
        <span className="spacer" />
        <a href={src} target="_blank" rel="noopener noreferrer" className="small">
          Open in new tab
        </a>
      </div>
      <iframe className="pdf-frame" src={src} title={title} />
    </div>
  );
}
