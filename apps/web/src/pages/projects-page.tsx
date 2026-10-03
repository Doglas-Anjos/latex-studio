import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type RefObject, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/button';
import { Dialog } from '../components/dialog';
import { Form } from '../components/form';
import { useService } from '../di/service-provider';
import { ProjectServiceToken } from '../services/project.service';
import { useWorkspaceStore } from '../workspace-store';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
const roleLabel = { owner: 'Dono', editor: 'Editor', reviewer: 'Revisor', viewer: 'Leitor' };

type DialogRef = RefObject<HTMLDialogElement | null>;

export function ProjectsPage() {
  const projects = useService(ProjectServiceToken);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, error, isPending } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projects.list(),
  });
  const createRef = useRef<HTMLDialogElement>(null);
  const importRef = useRef<HTMLDialogElement>(null);

  const open = (id: string) => {
    useWorkspaceStore.getState().setActivePath(null);
    navigate(`/projects/${id}`);
  };
  const remove = useMutation({
    mutationFn: (id: string) => projects.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <>
      <div className="page-head">
        <h1>Projetos</h1>
        <div className="actions">
          <Button variant="secondary" onClick={() => importRef.current?.showModal()}>
            Importar
          </Button>
          <Button variant="primary" onClick={() => createRef.current?.showModal()}>
            Novo projeto
          </Button>
        </div>
      </div>

      {isPending && <p className="status-note">Carregando…</p>}
      {error && <p className="form-error">Não foi possível carregar os projetos.</p>}
      {remove.error && <p className="form-error">{remove.error.message}</p>}
      {data?.length === 0 && (
        <div className="card empty">
          <p>Nenhum projeto ainda</p>
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="card user-list">
          {data.map((p) => (
            <li key={p.id}>
              <button type="button" className="link-row" onClick={() => open(p.id)}>
                <strong>{p.name}</strong>
                <span className="muted">
                  {roleLabel[p.role]} · atualizado em {dateFmt.format(new Date(p.updatedAt))}
                </span>
              </button>
              {p.role === 'owner' && (
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm(`Excluir o projeto "${p.name}"? Isso não pode ser desfeito.`))
                      remove.mutate(p.id);
                  }}
                >
                  Excluir
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <CreateDialog dialogRef={createRef} onDone={open} />
      <ImportDialog dialogRef={importRef} onDone={open} />
    </>
  );
}

function CreateDialog({
  dialogRef,
  onDone,
}: {
  dialogRef: DialogRef;
  onDone: (id: string) => void;
}) {
  const projects = useService(ProjectServiceToken);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => projects.create(name.trim()),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      dialogRef.current?.close();
      setName('');
      onDone(p.id);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Dialog ref={dialogRef} title="Novo projeto">
      <Form onSubmit={submit}>
        <Form.Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
        {create.error && <Form.Error>{errorText(create.error)}</Form.Error>}
        <div className="actions">
          <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={create.isPending}>
            Criar
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function ImportDialog({
  dialogRef,
  onDone,
}: {
  dialogRef: DialogRef;
  onDone: (id: string) => void;
}) {
  const projects = useService(ProjectServiceToken);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'zip' | 'folder'>('zip');
  const [picked, setPicked] = useState<File[]>([]);
  const imported = useMutation({
    mutationFn: () => {
      const first = picked[0];
      if (!first) throw new Error('Escolha um arquivo .zip ou uma pasta');
      if (mode === 'zip') return projects.import({ name: name.trim(), archive: first });
      // webkitRelativePath is "folder/sub/file": drop the leading folder segment.
      const files = picked.map((file) => ({
        file,
        path: file.webkitRelativePath.split('/').slice(1).join('/') || file.name,
      }));
      return projects.import({ name: name.trim(), files });
    },
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      dialogRef.current?.close();
      setName('');
      setPicked([]);
      onDone(p.id);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    imported.mutate();
  };
  return (
    <Dialog ref={dialogRef} title="Importar projeto">
      <Form onSubmit={submit}>
        <Form.Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="tabs" role="tablist">
          {(['zip', 'folder'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setPicked([]);
              }}
            >
              {m === 'zip' ? 'Arquivo .zip' : 'Pasta'}
            </button>
          ))}
        </div>
        {mode === 'zip' ? (
          <input
            key="zip"
            type="file"
            accept=".zip"
            aria-label="Arquivo .zip"
            onChange={(e) => setPicked(Array.from(e.target.files ?? []))}
          />
        ) : (
          <input
            key="folder"
            type="file"
            multiple
            aria-label="Pasta"
            // @ts-expect-error non-standard attribute, supported by all major browsers
            webkitdirectory=""
            onChange={(e) => setPicked(Array.from(e.target.files ?? []))}
          />
        )}
        {imported.error && <Form.Error>{errorText(imported.error)}</Form.Error>}
        <div className="actions">
          <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={imported.isPending}>
            {imported.isPending ? 'Importando…' : 'Importar'}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function errorText(e: Error) {
  const status = (e as { status?: number }).status;
  if (status === 409) return 'Limite de projetos atingido';
  if (status === 413) return 'Cota de armazenamento excedida';
  if (status === 400) return `Requisição inválida: ${e.message}`;
  return e.message;
}
