import * as pdfjs from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import { CompileServiceToken } from '../services/compile.service';
import { useBuilds } from './use-builds';
import { useZoom } from './use-zoom';
import { ZoomControls } from './zoom-controls';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export function PdfViewer({ projectId }: { projectId: string }) {
  const compile = useService(CompileServiceToken);
  const { data: builds } = useBuilds(projectId);
  const buildId = builds?.find((b) => b.status === 'succeeded')?.id;
  const host = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(body);

  // External sync: PDF.js renders into canvases outside React's tree.
  useEffect(() => {
    const parent = host.current;
    if (!parent || !buildId) return;
    let cancelled = false;
    setError(false);
    const task = (async () => {
      const data = await compile.pdf(projectId, buildId);
      const pdf = await pdfjs.getDocument({ data }).promise;
      const ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = (parent.clientWidth || base.width) / base.width;
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        await page.render({ canvas, viewport }).promise;
        if (!cancelled) parent.append(canvas);
      }
      return pdf;
    })();
    task.catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      parent.replaceChildren();
      task.then((pdf) => pdf.loadingTask.destroy()).catch(() => {});
    };
  }, [compile, projectId, buildId]);

  return (
    <div className="pdf-viewer">
      {buildId && !error && (
        <div className="zoom-bar">
          <ZoomControls zoom={zoom} zoomIn={zoomIn} zoomOut={zoomOut} reset={reset} />
        </div>
      )}
      <div ref={body} className="pdf-viewer-body">
        {!buildId && <p className="status-note">Compile o projeto para ver o PDF.</p>}
        {error && <p className="form-error">Não foi possível exibir o PDF.</p>}
        <div
          ref={host}
          className="pdf-pages"
          style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}
        />
      </div>
    </div>
  );
}
