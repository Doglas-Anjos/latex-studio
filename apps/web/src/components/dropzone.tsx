import { Upload, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from './button';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Drag-and-drop + native picker for one or more files. Shows the current selection, or
 * `children` in its place when the caller renders its own (e.g. with destinations).
 */
export function Dropzone({
  accept,
  multiple,
  directory,
  disabled,
  label,
  hint,
  browseLabel,
  files,
  onFiles,
  children,
}: {
  accept?: string;
  multiple?: boolean;
  /** Non-standard but supported by all major browsers; drag-and-drop stays off, see the hint. */
  directory?: boolean;
  disabled?: boolean;
  label: string;
  hint?: string;
  browseLabel: string;
  files: File[];
  onFiles: (files: File[]) => void;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragAndDrop = !directory;

  useEffect(() => {
    if (directory) inputRef.current?.setAttribute('webkitdirectory', '');
  }, [directory]);

  return (
    <div className="dropzone-field">
      <fieldset
        className="dropzone"
        data-drag-over={dragOver || undefined}
        data-disabled={disabled || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && dragAndDrop) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled && dragAndDrop) onFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <legend className="sr-only">{label}</legend>
        <Upload size={22} className="dropzone-icon" aria-hidden="true" />
        <p className="dropzone-label">{label}</p>
        {hint && <p className="dropzone-hint muted">{hint}</p>}
        <Button
          variant="secondary"
          size="compact"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {browseLabel}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          hidden
          aria-label={browseLabel}
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </fieldset>
      {children}
      {!children && files.length > 0 && (
        <ul className="dropzone-files">
          {files.map((file) => (
            <li key={`${file.webkitRelativePath || file.name}-${file.size}-${file.lastModified}`}>
              <span className="dropzone-file-name" title={file.webkitRelativePath || file.name}>
                {file.webkitRelativePath || file.name}
              </span>
              <span className="dropzone-file-size muted">{formatSize(file.size)}</span>
              <button
                type="button"
                className="dropzone-file-remove"
                aria-label={`Remover ${file.name}`}
                onClick={() => onFiles(files.filter((f) => f !== file))}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!children && multiple && files.length > 1 && (
        <p className="muted dropzone-count">{files.length} arquivos selecionados</p>
      )}
    </div>
  );
}
