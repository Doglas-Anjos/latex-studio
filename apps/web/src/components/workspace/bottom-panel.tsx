import { BuildPanel } from '../build-panel';

/** The compile bar stays visible; BuildPanel itself toggles the logs/errors/warnings area. */
export function BottomPanel({ projectId, canCompile }: { projectId: string; canCompile: boolean }) {
  return (
    <div className="bottom-panel">
      <BuildPanel projectId={projectId} canCompile={canCompile} />
    </div>
  );
}
