import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus, FolderPlus, Pencil, Trash2, Upload as UploadIcon } from 'lucide-react';
import { type FormEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import { FileServiceToken, type ProjectFile } from '../services/file.service';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';
import { Dialog } from './dialog';
import { Form } from './form';

function invalidPathReason(path: string): string | null {
  if (!path) return 'Informe um caminho.';
  if (path.startsWith('/')) return 'O caminho não deve começar com "/".';
  if (path.split('/').some((segment) => segment === '..')) {
    return 'O caminho não pode conter "..".';
  }
  return null;
}

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

function useResetOnClose(dialogRef: RefObject<HTMLDialogElement | null>, reset: () => void) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener('close', reset);
    return () => dialog.removeEventListener('close', reset);
  }, [dialogRef, reset]);
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
  const newFileRef = useRef<HTMLDialogElement>(null);
  const newFolderRef = useRef<HTMLDialogElement>(null);
  const renameRef = useRef<HTMLDialogElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const { data, error, isPending } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => files.list(projectId),
  });
  const tree = useMemo(() => buildTree(data ?? []), [data]);

  const run = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
  });

  const rename = (from: string) => {
    setRenamingPath(from);
    renameRef.current?.showModal();
  };
  const remove = (path: string) => {
    setDeletingPath(path);
    deleteRef.current?.showModal();
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
                    title={`Renomear ${n.name}`}
                    onClick={() => rename(n.path)}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir ${n.name}`}
                    title={`Excluir ${n.name}`}
                    onClick={() => remove(n.path)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
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
          <button type="button" onClick={() => newFileRef.current?.showModal()}>
            <FilePlus size={14} aria-hidden="true" /> Novo arquivo
          </button>
          <button type="button" onClick={() => newFolderRef.current?.showModal()}>
            <FolderPlus size={14} aria-hidden="true" /> Nova pasta
          </button>
          <button type="button" onClick={() => uploadRef.current?.click()}>
            <UploadIcon size={14} aria-hidden="true" /> Upload
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

      <PathDialog
        dialogRef={newFileRef}
        projectId={projectId}
        title="Novo arquivo"
        description="Caminho relativo dentro do projeto."
        placeholder="capitulos/intro.tex"
        confirmLabel="Criar"
        action={(id, path) => files.create(id, path)}
        onDone={setActivePath}
      />
      <PathDialog
        dialogRef={newFolderRef}
        projectId={projectId}
        title="Nova pasta"
        description="Caminho relativo dentro do projeto."
        placeholder="capitulos"
        confirmLabel="Criar"
        action={(id, path) => files.createFolder(id, path)}
      />
      <RenameDialog
        dialogRef={renameRef}
        projectId={projectId}
        from={renamingPath}
        activePath={activePath}
        setActivePath={setActivePath}
      />
      <DeleteDialog
        dialogRef={deleteRef}
        projectId={projectId}
        path={deletingPath}
        activePath={activePath}
        setActivePath={setActivePath}
      />
    </nav>
  );
}

function PathDialog({
  dialogRef,
  projectId,
  title,
  description,
  placeholder,
  confirmLabel,
  action,
  onDone,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  projectId: string;
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  action: (projectId: string, path: string) => Promise<void>;
  onDone?: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => action(projectId, path.trim()),
    onSuccess: () => {
      const created = path.trim();
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      dialogRef.current?.close();
      onDone?.(created);
    },
  });
  useResetOnClose(dialogRef, () => {
    setPath('');
    setLocalError(null);
    mutation.reset();
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    const reason = invalidPathReason(path.trim());
    if (reason) {
      setLocalError(reason);
      return;
    }
    setLocalError(null);
    mutation.mutate();
  };
  const cancel = () => dialogRef.current?.close();
  return (
    <Dialog ref={dialogRef} title={title} pending={mutation.isPending}>
      <Form onSubmit={submit}>
        <p>{description}</p>
        <Form.Field
          label="Caminho"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setLocalError(null);
          }}
          placeholder={placeholder}
          autoFocus
          required
        />
        {(localError || mutation.error) && (
          <Form.Error>{localError ?? mutation.error?.message}</Form.Error>
        )}
        <div className="actions">
          <Button variant="ghost" onClick={cancel} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : confirmLabel}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function RenameDialog({
  dialogRef,
  projectId,
  from,
  activePath,
  setActivePath,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  projectId: string;
  from: string | null;
  activePath: string | null;
  setActivePath: (path: string | null) => void;
}) {
  const files = useService(FileServiceToken);
  const queryClient = useQueryClient();
  const [to, setTo] = useState(from ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  // `from` changes before the dialog repaints (showModal is called synchronously
  // right after setState); reset the field here instead of via a remount key.
  const mutation = useMutation({
    mutationFn: () => files.rename(projectId, from ?? '', to.trim()),
    onSuccess: () => {
      const renamed = to.trim();
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      dialogRef.current?.close();
      if (activePath === from) {
        setActivePath(renamed);
      } else if (from && activePath?.startsWith(`${from}/`)) {
        setActivePath(renamed + activePath.slice(from.length));
      }
    },
  });
  const [lastFrom, setLastFrom] = useState(from);
  if (from !== lastFrom) {
    setLastFrom(from);
    setTo(from ?? '');
    setLocalError(null);
    mutation.reset();
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!from || mutation.isPending) return;
    const trimmed = to.trim();
    if (trimmed === from) {
      dialogRef.current?.close();
      return;
    }
    const reason = invalidPathReason(trimmed);
    if (reason) {
      setLocalError(reason);
      return;
    }
    setLocalError(null);
    mutation.mutate();
  };
  return (
    <Dialog ref={dialogRef} title="Renomear" pending={mutation.isPending}>
      <Form onSubmit={submit}>
        <p>Novo caminho para "{from}".</p>
        <Form.Field
          label="Caminho"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setLocalError(null);
          }}
          autoFocus
          required
        />
        {(localError || mutation.error) && (
          <Form.Error>{localError ?? mutation.error?.message}</Form.Error>
        )}
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => dialogRef.current?.close()}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Renomear'}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function DeleteDialog({
  dialogRef,
  projectId,
  path,
  activePath,
  setActivePath,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  projectId: string;
  path: string | null;
  activePath: string | null;
  setActivePath: (path: string | null) => void;
}) {
  const files = useService(FileServiceToken);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => files.remove(projectId, path ?? ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      dialogRef.current?.close();
      if (activePath === path || (path && activePath?.startsWith(`${path}/`))) {
        setActivePath(null);
      }
    },
  });
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    mutation.reset();
  }
  return (
    <Dialog ref={dialogRef} title="Excluir" pending={mutation.isPending}>
      <p>Excluir "{path}"? Essa ação não pode ser desfeita.</p>
      {mutation.error && <Form.Error>{mutation.error.message}</Form.Error>}
      <div className="actions">
        <Button
          variant="ghost"
          onClick={() => dialogRef.current?.close()}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={() => !mutation.isPending && mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Excluindo…' : 'Excluir'}
        </Button>
      </div>
    </Dialog>
  );
}
