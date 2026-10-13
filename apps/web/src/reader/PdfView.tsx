import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

// Bundled with the app (not a CDN), so the original view works offline. The legacy build supports older WebViews.
GlobalWorkerOptions.workerSrc = workerUrl;

/** Canvas pixels per page at most; mobile WebViews run out of canvas memory well before desktop browsers do. */
const MAX_PAGE_PIXELS = 8_000_000;

/**
 * The original PDF, page by page. Only pages near the screen are drawn; the rest keep their size
 * as empty boxes, so long documents scroll smoothly and stay within mobile memory limits.
 */
export default function PdfView({ blob }: { blob: Blob }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [pageRatio, setPageRatio] = useState(11 / 8.5);

  useEffect(() => {
    let task: ReturnType<typeof getDocument> | null = null;
    let live = true;
    void blob.arrayBuffer().then(async (bytes) => {
      if (!live) return;
      task = getDocument({ data: new Uint8Array(bytes) });
      try {
        const loaded = await task.promise;
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
        if (!live) return;
        setPageRatio(first.height / first.width);
        setDoc(loaded);
      } catch {
        if (live) setError(true);
      }
    });
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [blob]);

  if (error) return <p className="pdf-message">This PDF couldn’t be opened.</p>;
  if (!doc) return <p className="pdf-message">Opening the PDF…</p>;
  return (
    <div className="pdf-view">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPage key={i} doc={doc} pageNumber={i + 1} estimatedRatio={pageRatio} />
      ))}
    </div>
  );
}

function PdfPage({ doc, pageNumber, estimatedRatio }: { doc: PDFDocumentProxy; pageNumber: number; estimatedRatio: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [ratio, setRatio] = useState(estimatedRatio);

  useEffect(() => {
    const box = boxRef.current!;
    const observer = new IntersectionObserver(([entry]) => setNear(entry!.isIntersecting), { rootMargin: '150% 0px' });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let render: { cancel(): void; promise: Promise<void> } | null = null;
    void doc.getPage(pageNumber).then((page) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const cssWidth = boxRef.current!.clientWidth;
      let scale = (cssWidth * window.devicePixelRatio) / base.width;
      scale = Math.min(scale, Math.sqrt(MAX_PAGE_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      render = page.render({ canvas, viewport });
      render.promise.catch(() => {}); // cancelled when scrolled away
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [near, doc, pageNumber]);

  return (
    <div ref={boxRef} className="pdf-page" style={{ aspectRatio: `1 / ${ratio}` }} aria-label={`Page ${pageNumber}`}>
      {near && <canvas ref={canvasRef} />}
    </div>
  );
}
