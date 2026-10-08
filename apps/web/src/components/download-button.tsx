import { useMutation } from '@tanstack/react-query';
import { Archive, Download, FileDown, FileText, GitBranch } from 'lucide-react';
import { useService } from '../di/service-provider';
import { CompileServiceToken } from '../services/compile.service';
import { ProjectServiceToken } from '../services/project.service';
import { type ExportFormat, ToolsServiceToken } from '../services/tools.service';
import { Menu } from './menu';
import { useBuilds } from './use-builds';
import { waitForJob } from './use-tools-job';

const EXPORTS: [ExportFormat, string][] = [
  ['docx', 'Word (.docx)'],
  ['md', 'Markdown (.md)'],
  ['html', 'HTML (.html)'],
];

/**
 * Split button in the workspace header, next to the Código/PDF switch so it reaches whether the
 * code or the PDF is on screen: the main action downloads the compiled PDF (the default), and the
 * caret offers the project source and the Word/Markdown/HTML exports. Shown to everyone (viewers
 * can download the PDF and source); only editors see the exports, which run a worker job.
 */
export function DownloadButton({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const compile = useService(CompileServiceToken);
  const projects = useService(ProjectServiceToken);
  const tools = useService(ToolsServiceToken);
  const { data: builds } = useBuilds(projectId);
  const build = builds?.[0];
  const pdfReady = build?.status === 'succeeded';

  const exportAs = useMutation({
    mutationFn: async (format: ExportFormat) => {
      const { jobId } = await tools.requestExport(projectId, format);
      await waitForJob(tools, projectId, jobId);
      await tools.downloadJobFile(projectId, jobId, `project.${format}`);
    },
  });

  const downloadPdf = () => {
    if (pdfReady && build) void compile.downloadPdf(projectId, build.id);
  };

  return (
    <div className="pdf-download">
      <button
        type="button"
        className="pdf-download-main"
        disabled={!pdfReady}
        title={pdfReady ? 'Baixar o PDF compilado' : 'Compile o projeto para baixar o PDF'}
        onClick={downloadPdf}
      >
        <Download size={16} aria-hidden="true" />
        Baixar
      </button>
      <Menu
        label={<span className="sr-only">Mais opções de download</span>}
        triggerClassName="pdf-download-caret"
        className="pdf-download-menu"
      >
        <button type="button" disabled={!pdfReady} onClick={downloadPdf}>
          <FileDown size={16} aria-hidden="true" /> PDF
        </button>
        <button type="button" onClick={() => void projects.downloadSource(projectId)}>
          <Archive size={16} aria-hidden="true" /> Fonte (.zip)
        </button>
        <button type="button" onClick={() => void projects.downloadSource(projectId, true)}>
          <GitBranch size={16} aria-hidden="true" /> Fonte com histórico (.zip)
        </button>
        {canEdit &&
          EXPORTS.map(([format, label]) => (
            <button
              key={format}
              type="button"
              disabled={exportAs.isPending}
              onClick={() => exportAs.mutate(format)}
            >
              <FileText size={16} aria-hidden="true" /> {label}
            </button>
          ))}
      </Menu>
      {exportAs.isPending && <span className="pdf-download-busy">Exportando…</span>}
    </div>
  );
}
