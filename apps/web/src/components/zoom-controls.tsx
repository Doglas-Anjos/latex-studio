import { Minus, Plus } from 'lucide-react';
import type { ZoomApi } from './use-zoom';

export function ZoomControls({ zoom, zoomIn, zoomOut, reset }: ZoomApi) {
  const pct = Math.round(zoom * 100);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> drags in form semantics and default styling for what is a toolbar-like button group.
    <div className="zoom-toolbar" role="group" aria-label="Zoom">
      <button
        type="button"
        className="zoom-btn"
        onClick={zoomOut}
        title="Diminuir zoom (Ctrl+roda)"
        aria-label="Diminuir zoom"
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="zoom-btn zoom-pct"
        onClick={reset}
        title="Restaurar zoom (100%)"
        aria-label={`Zoom ${pct}%, clique para restaurar`}
      >
        {pct}%
      </button>
      <button
        type="button"
        className="zoom-btn"
        onClick={zoomIn}
        title="Aumentar zoom (Ctrl+roda)"
        aria-label="Aumentar zoom"
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
