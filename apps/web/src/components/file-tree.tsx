import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import { FileServiceToken, type ProjectFile } from '../services/file.service';
import { useWorkspaceStore } from '../workspace-store';

interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[]; // present only for folders
}

export function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const { path } of files) {
    let dir = root;
    const parts = path.split('/');
    parts.forEach((name, i) => {
      const nodePath = parts.slice(0, i + 1).join('/');
      const isFile = i === parts.length - 1;
      let node = dir.children?.find((c) => c.name === name && !c.children === isFile);
      if (!node) {
        node = isFile ? { name, path: nodePath } : { name, path: nodePath, children: [] };
        dir.children?.push(node);
      }
      dir = node;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort(
      (a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name),
    );
    for (const n of nodes) if (n.children) sort(n.children);
  };
  sort(root.children ?? []);
  return root.children ?? [];
}

export function FileTree({
  projectId,
  canEdit,
  mainFile,
}: {
  projectId: string;
  canEdit: boolean;
  mainFile: string;
}) {
  const files = useService(FileServiceToken);
  const queryClient = useQueryClient();
  const activePath = useWorkspaceStore((s) => s.activePath) ?? mainFile;
  const setActivePath = useWorkspaceStore((s) => s.setActivePath);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const uploadRef = useRef<HTMLInputElement>(null);

  const { data, error, isPending } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => files.list(projectId),
  });
  const tree = useMemo(() => buildTree(data ?? []), [data]);

  const run = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
  });

  const newFile = () => {
    const path = prompt('Caminho do novo arquivo (ex.: capitulos/intro.tex)')?.trim();
    if (!path) return;
    run.mutate(async () => {
      await files.create(projectId, path);
      setActivePath(path);
    });
  };
  const newFolder = () => {
    const path = prompt('Caminho da nova pasta')?.trim();
    if (path) run.mutate(() => files.createFolder(projectId, path));
  };
  const rename = (from: string) => {
    const to = prompt('Novo caminho', from)?.trim();
    if (!to || to === from) return;
    run.mutate(async () => {
      await files.rename(projectId, from, to);
      if (activePath === from) setActivePath(to);
      else if (activePath?.startsWith(`${from}/`))
        setActivePath(to + activePath.slice(from.length));
    });
  };
  const remove = (path: string) => {
    if (!confirm(`Excluir "${path}"?`)) return;
    run.mutate(async () => {
      await files.remove(projectId, path);
      if (activePath === path || activePath?.startsWith(`${path}/`)) setActivePath(null);
    });
  };
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const renderNodes = (nodes: TreeNode[]) => (
    <ul>
      {nodes.map((n) => {
        const isFolder = !!n.children;
        const open = !collapsed.has(n.path);
        return (
          <li key={n.path}>
            <div className="tree-row" data-active={n.path === activePath}>
              <button
                type="button"
                className="tree-label"
                aria-expanded={isFolder ? open : undefined}
                onClick={() => (isFolder ? toggle(n.path) : setActivePath(n.path))}
              >
                <span aria-hidden="true">{isFolder ? (open ? '▾' : '▸') : '·'}</span> {n.name}
              </button>
              {canEdit && (
                <span className="tree-actions">
                  <button
                    type="button"
                    aria-label={`Renomear ${n.name}`}
                    onClick={() => rename(n.path)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir ${n.name}`}
                    onClick={() => remove(n.path)}
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
            {isFolder && open && n.children && renderNodes(n.children)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav className="file-tree" aria-label="Arquivos do projeto">
      {canEdit && (
        <div className="tree-toolbar">
          <button type="button" onClick={newFile}>
            Novo arquivo
          </button>
          <button type="button" onClick={newFolder}>
            Nova pasta
          </button>
          <button type="button" onClick={() => uploadRef.current?.click()}>
            Upload
          </button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            hidden
            aria-label="Enviar arquivos"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (picked.length) run.mutate(() => files.upload(projectId, picked));
            }}
          />
        </div>
      )}
      {isPending && <p className="status-note">Carregando…</p>}
      {error && <p className="form-error">Não foi possível listar os arquivos.</p>}
      {run.error && <p className="form-error">{run.error.message}</p>}
      {renderNodes(tree)}
    </nav>
  );
}
