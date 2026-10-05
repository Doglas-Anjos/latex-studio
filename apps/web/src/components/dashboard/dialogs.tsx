import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, FolderPlus, Trash2, Upload } from 'lucide-react';
import { type FormEvent, type RefObject, useId, useState } from 'react';
import { useService } from '../../di/service-provider';
import { ProjectServiceToken } from '../../services/project.service';
import { Button } from '../button';
import { Dialog } from '../dialog';
import { Dropzone } from '../dropzone';
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
  const formId = useId();
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
    <Dialog
      ref={dialogRef}
      title="Novo projeto"
      icon={<FolderPlus size={18} aria-hidden="true" />}
      kicker="Projeto em branco"
      description="Comece do zero; você adiciona os arquivos depois."
      pending={create.isPending}
      footer={
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => dialogRef.current?.close()}
            disabled={create.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={create.isPending}
            loading={create.isPending}
          >
            {create.isPending ? 'Criando…' : 'Criar'}
          </Button>
        </div>
      }
    >
      <Form id={formId} onSubmit={submit}>
        <Form.Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
        {create.error && <Form.Error>{errorText(create.error)}</Form.Error>}
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
  const formId = useId();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const [zipError, setZipError] = useState<string | null>(null);
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
  const pickZip = (dropped: File[]) => {
    const first = dropped[0];
    if (first && !/\.zip$/i.test(first.name)) {
      setZipError('Selecione um arquivo .zip.');
      setPicked([]);
      return;
    }
    setZipError(null);
    setPicked(first ? [first] : []);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    imported.mutate();
  };
  return (
    <Dialog
      ref={dialogRef}
      title="Importar projeto"
      icon={<Upload size={18} aria-hidden="true" />}
      kicker="Novo projeto"
      description="Envie um arquivo .zip ou selecione uma pasta do seu computador."
      pending={imported.isPending}
      footer={
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => dialogRef.current?.close()}
            disabled={imported.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={imported.isPending || picked.length === 0}
            loading={imported.isPending}
          >
            {imported.isPending ? 'Importando…' : 'Importar'}
          </Button>
        </div>
      }
    >
      <Form id={formId} onSubmit={submit}>
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
                setZipError(null);
              }}
            >
              {m === 'zip' ? 'Arquivo .zip' : 'Pasta'}
            </button>
          ))}
        </div>
        {mode === 'zip' ? (
          <Dropzone
            key="zip"
            accept=".zip"
            label="Arraste o arquivo .zip aqui"
            hint="ou selecione um arquivo do seu computador"
            browseLabel="Selecionar arquivo"
            files={picked}
            onFiles={pickZip}
          />
        ) : (
          <Dropzone
            key="folder"
            directory
            multiple
            label="Selecione uma pasta do seu computador"
            hint="Arrastar e soltar não é suportado para pastas; use o botão abaixo."
            browseLabel="Selecionar pasta"
            files={picked}
            onFiles={setPicked}
          />
        )}
        {zipError && <Form.Error>{zipError}</Form.Error>}
        {!zipError && imported.error && <Form.Error>{errorText(imported.error)}</Form.Error>}
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
  const projects = useService(ProjectServiceToken);
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState(project ? `Cópia de ${project.name}` : '');
  const copy = useMutation({
    mutationFn: () => projects.copy(project?.id ?? '', name.trim()),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      dialogRef.current?.close();
      onDone(p.id);
    },
  });
  // `project` changes before the dialog repaints (showModal is called synchronously
  // right after setState); reset the prefilled name here instead of via a remount key.
  const [lastProject, setLastProject] = useState(project);
  if (project !== lastProject) {
    setLastProject(project);
    setName(project ? `Cópia de ${project.name}` : '');
    copy.reset();
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!copy.isPending) copy.mutate();
  };
  return (
    <Dialog
      ref={dialogRef}
      title="Fazer uma cópia"
      icon={<Copy size={18} aria-hidden="true" />}
      kicker={project?.name}
      description={`Cria uma cópia independente de "${project?.name}".`}
      pending={copy.isPending}
      footer={
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => dialogRef.current?.close()}
            disabled={copy.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={copy.isPending}
            loading={copy.isPending}
          >
            {copy.isPending ? 'Copiando…' : 'Copiar'}
          </Button>
        </div>
      }
    >
      <Form id={formId} onSubmit={submit}>
        <Form.Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
        {copy.error && <Form.Error>{errorText(copy.error)}</Form.Error>}
      </Form>
    </Dialog>
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
    <Dialog
      ref={dialogRef}
      title="Excluir projeto"
      icon={<Trash2 size={18} aria-hidden="true" />}
      kicker={project?.name}
      description={`Excluir o projeto "${project?.name}"? Essa ação não pode ser desfeita.`}
      tone="danger"
      pending={remove.isPending}
      footer={
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
      }
    >
      {remove.error && <Form.Error>{errorText(remove.error)}</Form.Error>}
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
