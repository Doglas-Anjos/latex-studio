import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type RefObject, useState } from 'react';
import { useService } from '../../di/service-provider';
import { ProjectServiceToken } from '../../services/project.service';
import { Button } from '../button';
import { Dialog } from '../dialog';
import { Form } from '../form';

export type ImportMode = 'zip' | 'folder';
type DialogRef = RefObject<HTMLDialogElement | null>;

export function CreateDialog({
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

export function ImportDialog({
  dialogRef,
  mode,
  setMode,
  onDone,
}: {
  dialogRef: DialogRef;
  mode: ImportMode;
  setMode: (m: ImportMode) => void;
  onDone: (id: string) => void;
}) {
  const projects = useService(ProjectServiceToken);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
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

type Named = { id: string; name: string };

export function CopyDialog({
  dialogRef,
  project,
  onDone,
}: {
  dialogRef: DialogRef;
  project: Named | null;
  onDone: (id: string) => void;
}) {
  return (
    <Dialog ref={dialogRef} title="Fazer uma cópia">
      {/* keyed so the prefilled name resets for each project */}
      {project && (
        <CopyForm key={project.id} dialogRef={dialogRef} project={project} onDone={onDone} />
      )}
    </Dialog>
  );
}

function CopyForm({
  dialogRef,
  project,
  onDone,
}: {
  dialogRef: DialogRef;
  project: Named;
  onDone: (id: string) => void;
}) {
  const projects = useService(ProjectServiceToken);
  const queryClient = useQueryClient();
  const [name, setName] = useState(`Cópia de ${project.name}`);
  const copy = useMutation({
    mutationFn: () => projects.copy(project.id, name.trim()),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      dialogRef.current?.close();
      onDone(p.id);
    },
  });
  return (
    <Form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        copy.mutate();
      }}
    >
      <Form.Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
      {copy.error && <Form.Error>{errorText(copy.error)}</Form.Error>}
      <div className="actions">
        <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
          Cancelar
        </Button>
        <Button variant="primary" type="submit" disabled={copy.isPending}>
          Copiar
        </Button>
      </div>
    </Form>
  );
}

export function RemoveDialog({
  dialogRef,
  project,
  onDone,
}: {
  dialogRef: DialogRef;
  project: Named | null;
  onDone: () => void;
}) {
  const projects = useService(ProjectServiceToken);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => projects.remove(project?.id ?? ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      dialogRef.current?.close();
      onDone();
    },
  });
  return (
    <Dialog ref={dialogRef} title="Excluir projeto" pending={remove.isPending}>
      <p>Excluir o projeto "{project?.name}"? Essa ação não pode ser desfeita.</p>
      {remove.error && <Form.Error>{errorText(remove.error)}</Form.Error>}
      <div className="actions">
        <Button
          variant="ghost"
          onClick={() => dialogRef.current?.close()}
          disabled={remove.isPending}
        >
          Cancelar
        </Button>
        <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
          {remove.isPending ? 'Excluindo…' : 'Excluir'}
        </Button>
      </div>
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
