import { CircleHelp } from 'lucide-react';
import type { RefObject } from 'react';
import { Button } from '../button';
import { Dialog } from '../dialog';

const sections: [string, string][] = [
  [
    'Projetos são repositórios git',
    'Cada projeto tem histórico completo. "Salvar versão" cria um commit com mensagem; a cada 5 minutos o que mudou é salvo automaticamente em seu nome (autosave).',
  ],
  [
    'Arquivos alterados',
    'Nomes marcados em cor e com "M"/"A" na árvore ainda não entraram numa versão salva; o contador na barra lateral mostra quantos. A view "Mudanças" lista, compara (diff) e permite descartar.',
  ],
  [
    'Compilar',
    'A fila compila com o motor escolhido (pdfLaTeX, XeLaTeX ou LuaLaTeX; fontspec exige XeLaTeX ou LuaLaTeX). Erros e avisos aparecem no painel inferior com contagens; clique para ir à linha.',
  ],
  [
    'Bibliotecas',
    'Pacotes são ligados e desligados no painel sem comentar código; um pacote desligado que ainda está no .tex é pulado. Qualquer pacote do TeX Live pode ser adicionado pelo nome, e arquivos .sty próprios podem ser enviados ao projeto.',
  ],
  [
    'Colaboração',
    'Edição simultânea com cursores nomeados, comentários ancorados ao texto e membros com papéis (dono, editor, revisor, leitor).',
  ],
  [
    'Aparência',
    'Tema, fonte e cores de sintaxe ficam na engrenagem; Auto-indent e Blame ficam na barra de status.',
  ],
];

export function HelpDialog({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  return (
    <Dialog
      ref={dialogRef}
      title="Como o LaTeX Studio funciona"
      icon={<CircleHelp size={18} aria-hidden="true" />}
      footer={
        <div className="actions">
          <Button variant="primary" onClick={() => dialogRef.current?.close()}>
            Entendi
          </Button>
        </div>
      }
    >
      <div className="help-sections">
        {sections.map(([title, text]) => (
          <section key={title}>
            <h3>{title}</h3>
            <p>{text}</p>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
