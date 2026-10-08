import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import { CompileServiceToken } from '../services/compile.service';
import { useBuilds } from './use-builds';
import { useZoom } from './use-zoom';
import { ZoomControls } from './zoom-controls';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/** A loaded document plus page 1's size at scale 1, which sizes every placeholder. */
type Doc = { pdf: PDFDocumentProxy; width: number; height: number };

export function PdfViewer({ projectId }: { projectId: string }) {
  const compile = useService(CompileServiceToken);
  const { data: builds } = useBuilds(projectId);
  // useBuilds lists only the newest builds: after a run of failures the last good one drops out
  // of the list, but its PDF must stay on screen.
  const latest = builds?.find((b) => b.status === 'succeeded')?.id;
  const [last, setLast] = useState<{ projectId: string; id: string }>();
  if (latest && (last?.id !== latest || last.projectId !== projectId)) {
    setLast({ projectId, id: latest });
  }
  const buildId = latest ?? (last?.projectId === projectId ? last.id : undefined);
  const body = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState(false);
  const [fitWidth, setFitWidth] = useState(0);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(body);
  const keepScroll = useRef(0);

  // The previous document stays on screen until the new one is parsed.
  useEffect(() => {
    if (!buildId) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    setError(false);
    (async () => {
      const data = await compile.pdf(projectId, buildId);
      const pdf = await pdfjs.getDocument({ data }).promise;
      const base = cancelled ? null : (await pdf.getPage(1)).getViewport({ scale: 1 });
      if (cancelled || !base) return void pdf.loadingTask.destroy();
      keepScroll.current = body.current?.scrollTop ?? 0;
      setDoc({ pdf, width: base.width, height: base.height });
    })().catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [compile, projectId, buildId]);

  // A replaced (or unmounted) document frees its worker memory.
  useEffect(() => () => void doc?.pdf.loadingTask.destroy(), [doc]);

  useLayoutEffect(() => {
    if (doc && body.current) body.current.scrollTop = keepScroll.current;
  }, [doc]);

  useEffect(() => {
    const el = body.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFitWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = doc ? ((fitWidth || doc.width) / doc.width) * zoom : 1;

  // Lazy pages: only placeholders near the viewport get a canvas, rendered at the real zoom
  // (sharp, unlike a CSS-scaled bitmap). The old canvas stays until the new one is ready, so a
  // rebuild or zoom never flashes blank; pages far off-screen drop theirs and free PDF.js caches.
  useEffect(() => {
    const root = body.current;
    const pages = host.current;
    if (!doc || !root || !pages || typeof IntersectionObserver === 'undefined') return;
    const ratio = window.devicePixelRatio || 1;
    const tasks = new Map<Element, RenderTask>();
    let alive = true;
    const draw = async (el: HTMLElement) => {
      const page = await doc.pdf.getPage(Number(el.dataset.page));
      if (!alive) return;
      const viewport = page.getViewport({ scale: scale * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvas, viewport });
      tasks.get(el)?.cancel();
      tasks.set(el, task);
      await task.promise;
      if (alive) el.replaceChildren(canvas);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const el = target as HTMLElement;
          if (isIntersecting) {
            draw(el).catch(() => {});
            continue;
          }
          tasks.get(el)?.cancel();
          tasks.delete(el);
          el.replaceChildren();
          doc.pdf
            .getPage(Number(el.dataset.page))
            .then((p) => p.cleanup())
            .catch(() => {});
        }
      },
      { root, rootMargin: '200% 0px' },
    );
    for (const el of pages.children) io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
      for (const t of tasks.values()) t.cancel();
    };
  }, [doc, scale]);

  return (
    <div className="pdf-viewer">
      {buildId && !error && (
        <div className="pdf-bar">
          <ZoomControls zoom={zoom} zoomIn={zoomIn} zoomOut={zoomOut} reset={reset} />
        </div>
      )}
      <div ref={body} className="pdf-viewer-body">
        {!buildId && <p className="status-note">Compile o projeto para ver o PDF.</p>}
        {error && <p className="form-error">Não foi possível exibir o PDF.</p>}
        <div ref={host} className="pdf-pages">
          {/* ponytail: every placeholder has page 1's size; a mixed-size document letterboxes
              the odd pages (object-fit) until per-page sizes are worth fetching up front. */}
          {doc &&
            Array.from({ length: doc.pdf.numPages }, (_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the page number is the identity
                key={i}
                className="pdf-page"
                data-page={i + 1}
                style={{ width: doc.width * scale, height: doc.height * scale }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
