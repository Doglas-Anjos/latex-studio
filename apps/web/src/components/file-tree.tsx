import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  File as FileIcon,
  FileImage,
  FilePlus,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  History,
  Pencil,
  Trash2,
  Upload as UploadIcon,
} from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useService } from '../di/service-provider';
import { useHistoryStatus } from '../hooks/use-history-status';
import { FileServiceToken, type ProjectFile } from '../services/file.service';
import { useSettingsStore } from '../settings-store';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';
import { Dialog } from './dialog';
import { Dropzone } from './dropzone';
import { Form } from './form';

function invalidPathReason(path: string): string | null {
  if (!path) return 'Informe um caminho.';
  if (path.startsWith('/')) return 'O caminho não deve começar com "/".';
  if (path.split('/').some((segment) => segment === '..')) {
    return 'O caminho não pode conter "..".';
  }
  return null;
}

export type FileKind = 'tex' | 'bib' | 'style' | 'image' | 'pdf' | 'generic';

const EXTENSION_KINDS: Record<string, FileKind> = {
  tex: 'tex',
  bib: 'bib',
  sty: 'style',
  cls: 'style',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  svg: 'image',
  webp: 'image',
  pdf: 'pdf',
};

export function classifyFile(name: string): FileKind {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return EXTENSION_KINDS[ext] ?? 'generic';
}

const isTextFile = (name: string) => /\.(tex|bib|sty|cls|txt|md|json)$/i.test(name);

const KIND_ICONS: Record<FileKind, typeof FileCode2> = {
  tex: FileCode2,
  bib: FileText,
  style: FileCode2,
  image: FileImage,
  pdf: FileText,
  generic: FileIcon,
};

export function FileTypeIcon({ name }: { name: string }) {
  const kind = classifyFile(name);
  const Icon = KIND_ICONS[kind];
  return <Icon size={14} className={`file-icon file-icon-${kind}`} aria-hidden="true" />;
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
  const activePath = useWorkspaceStore((s) => s.activePath) ?? mainFile;
  const setActivePath = useWorkspaceStore((s) => s.setActivePath);
  const setHistoryScope = useWorkspaceStore((s) => s.setHistoryScope);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const uploadRef = useRef<HTMLDialogElement>(null);
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
  const status = useHistoryStatus(projectId).data;
  const { dirty, dirtyDirs } = useMemo(() => {
    const dirty = new Map<string, 'add' | 'modify'>();
    const dirtyDirs = new Set<string>();
    for (const c of status?.changes ?? []) {
      if (c.type === 'remove') continue;
      dirty.set(c.path, c.type);
      const parts = c.path.split('/');
      for (let i = 1; i < parts.length; i++) dirtyDirs.add(parts.slice(0, i).join('/'));
    }
    return { dirty, dirtyDirs };
  }, [status]);

  const rename = (from: string) => {
    setRenamingPath(from);
    renameRef.current?.showModal();
  };
  const remove = (path: string) => {
    setDeletingPath(path);
    deleteRef.current?.showModal();
  };
  const showFileHistory = (path: string) => {
    setActivePath(path);
    setHistoryScope('file');
    useSettingsStore.getState().set({ sidebarView: 'history' });
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
        const dirtyType = isFolder ? undefined : dirty.get(n.path);
        return (
          <li key={n.path}>
            <div className="tree-row" data-active={n.path === activePath}>
              <button
                type="button"
                className="tree-label"
                aria-expanded={isFolder ? open : undefined}
                title={n.name}
                onClick={() => (isFolder ? toggle(n.path) : setActivePath(n.path))}
              >
                {isFolder ? (
                  <>
                    {open ? (
                      <ChevronDown size={14} className="tree-chevron" aria-hidden="true" />
                    ) : (
                      <ChevronRight size={14} className="tree-chevron" aria-hidden="true" />
                    )}
                    {open ? (
                      <FolderOpen
                        size={14}
                        className="file-icon file-icon-folder"
                        aria-hidden="true"
                      />
                    ) : (
                      <FolderIcon
                        size={14}
                        className="file-icon file-icon-folder"
                        aria-hidden="true"
                      />
                    )}
                  </>
                ) : (
                  <FileTypeIcon name={n.name} />
                )}
                <span className="tree-label-text" data-dirty={dirtyType}>
                  {n.name}
                </span>
                {dirtyType && (
                  <span
                    className="tree-dirty"
                    data-type={dirtyType}
                    title="Alterado desde a última versão salva"
                  >
                    {dirtyType === 'add' ? 'A' : 'M'}
                  </span>
                )}
                {isFolder && dirtyDirs.has(n.path) && (
                  <span
                    className="tree-dirty tree-dirty-dot"
                    data-type="modify"
                    title="Contém arquivos alterados desde a última versão salva"
                  />
                )}
              </button>
              {(canEdit || (!isFolder && isTextFile(n.name))) && (
                <span className="tree-actions">
                  {!isFolder && isTextFile(n.name) && (
                    <button
                      type="button"
                      aria-label={`Histórico de ${n.name}`}
                      title="Ver alterações deste arquivo"
                      onClick={() => showFileHistory(n.path)}
                    >
                      <History size={13} aria-hidden="true" />
                    </button>
                  )}
                  {canEdit && (
                    <>
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
                    </>
                  )}
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
          <button
            type="button"
            className="tree-toolbar-btn tree-toolbar-btn-primary"
            onClick={() => newFileRef.current?.showModal()}
          >
            <FilePlus size={14} aria-hidden="true" />
            <span>Novo arquivo</span>
          </button>
          <button
            type="button"
            className="tree-toolbar-btn"
            onClick={() => newFolderRef.current?.showModal()}
          >
            <FolderPlus size={14} aria-hidden="true" />
            <span>Nova pasta</span>
          </button>
          <button
            type="button"
            className="tree-toolbar-btn"
            onClick={() => uploadRef.current?.showModal()}
          >
            <UploadIcon size={14} aria-hidden="true" />
            <span>Upload</span>
          </button>
        </div>
      )}
      {isPending && <p className="status-note">Carregando…</p>}
      {error && <p className="form-error">Não foi possível listar os arquivos.</p>}
      {renderNodes(tree)}

      <UploadDialog dialogRef={uploadRef} projectId={projectId} />

      <PathDialog
        dialogRef={newFileRef}
        projectId={projectId}
        title="Novo arquivo"
        icon={<FilePlus size={18} aria-hidden="true" />}
        kicker="Novo item"
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
        icon={<FolderPlus size={18} aria-hidden="true" />}
        kicker="Novo item"
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
      <DeleteDialog dialogRef={deleteRef} projectId={projectId} path={deletingPath} />
    </nav>
  );
}

function UploadDialog({
  dialogRef,
  projectId,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  projectId: string;
}) {
  const files = useService(FileServiceToken);
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<File[]>([]);
  const mutation = useMutation({
    mutationFn: () => files.upload(projectId, picked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      dialogRef.current?.close();
    },
  });
  useResetOnClose(dialogRef, () => {
    setPicked([]);
    mutation.reset();
  });
  const formId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (picked.length === 0 || mutation.isPending) return;
    mutation.mutate();
  };
  return (
    <Dialog
      ref={dialogRef}
      title="Enviar arquivos"
      icon={<UploadIcon size={18} aria-hidden="true" />}
      kicker="Arquivos do projeto"
      pending={mutation.isPending}
      footer={
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => dialogRef.current?.close()}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={mutation.isPending || picked.length === 0}
            loading={mutation.isPending}
          >
            {mutation.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      }
    >
      <Form id={formId} onSubmit={submit}>
        <Dropzone
          multiple
          label="Arraste os arquivos aqui"
          hint="ou selecione do seu computador"
          browseLabel="Selecionar arquivos"
          files={picked}
          onFiles={setPicked}
        />
        {mutation.error && <Form.Error>{mutation.error.message}</Form.Error>}
      </Form>
    </Dialog>
  );
}

function PathDialog({
  dialogRef,
  projectId,
  title,
  icon,
  kicker,
  description,
  placeholder,
  confirmLabel,
  action,
  onDone,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  projectId: string;
  title: string;
  icon: ReactNode;
  kicker: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  action: (projectId: string, path: string) => Promise<void>;
  onDone?: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const hintId = useId();
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
    <Dialog
      ref={dialogRef}
      title={title}
      icon={icon}
      kicker={kicker}
      description={description}
      pending={mutation.isPending}
      footer={
        <div className="actions">
          <Button variant="ghost" onClick={cancel} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : confirmLabel}
          </Button>
        </div>
      }
    >
      <Form id={formId} onSubmit={submit}>
        <Form.Field
          label="Caminho"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setLocalError(null);
          }}
          placeholder={placeholder}
          aria-describedby={hintId}
          autoFocus
          required
        />
        <p id={hintId} className="field-hint">
          Exemplo: <code>{placeholder}</code>
        </p>
        {(localError || mutation.error) && (
          <Form.Error>{localError ?? mutation.error?.message}</Form.Error>
        )}
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
  const formId = useId();
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
      if (!from) return;
      // Tabs on the old path would reconnect to a document the server no longer has.
      useWorkspaceStore.getState().closeTabsUnder(from);
      if (activePath === from) {
        setActivePath(renamed);
      } else if (activePath?.startsWith(`${from}/`)) {
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
    <Dialog
      ref={dialogRef}
      title="Renomear"
      icon={<Pencil size={18} aria-hidden="true" />}
      kicker={from ? <code>{from}</code> : undefined}
      description={`Novo caminho para "${from}".`}
      pending={mutation.isPending}
      footer={
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => dialogRef.current?.close()}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Renomear'}
          </Button>
        </div>
      }
    >
      <Form id={formId} onSubmit={submit}>
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
      </Form>
    </Dialog>
  );
}

function DeleteDialog({
  dialogRef,
  projectId,
  path,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  projectId: string;
  path: string | null;
}) {
  const files = useService(FileServiceToken);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => files.remove(projectId, path ?? ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      dialogRef.current?.close();
      if (path) useWorkspaceStore.getState().closeTabsUnder(path);
    },
  });
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    mutation.reset();
  }
  return (
    <Dialog
      ref={dialogRef}
      title="Excluir"
      icon={<Trash2 size={18} aria-hidden="true" />}
      kicker={path ? <code>{path}</code> : undefined}
      description={`Excluir "${path}"? Essa ação não pode ser desfeita.`}
      tone="danger"
      pending={mutation.isPending}
      footer={
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
      }
    >
      {mutation.error && <Form.Error>{mutation.error.message}</Form.Error>}
    </Dialog>
  );
}
