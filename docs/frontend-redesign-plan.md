# Plano de evolução do frontend do LaTeX Studio

## Objetivo

Transformar o workspace em uma ferramenta de escrita técnica clara, confortável e confiável. A referência de uso é a familiaridade do Overleaf com a organização do VS Code, mantendo uma identidade própria. O trabalho abrange layout, responsividade, editor, diff, mudanças, comentários, compilação, navegação por arquivos e padrões de interface.

Este plano parte da auditoria estática feita com Claude Sonnet e da inspeção do projeto aberto no navegador em 1140 × 800. As alterações locais já presentes no repositório devem ser preservadas e revisadas como parte da implementação.

## Diagnóstico com evidências

| Área | Evidência observada | Consequência |
| --- | --- | --- |
| Layout e logs | Com os logs abertos, `document.scrollingElement.scrollHeight` foi 1350 px numa janela de 800 px; a barra inferior continuou em `y=767`. `.bottom-slot[data-open=true]` usa `max-height`, mas o conteúdo interno não recebe uma altura limitada completa (`styles.css`, `project-page.tsx`, `bottom-panel.tsx`). | O log passa por trás da barra de estado e a página inteira rola. |
| Diff | `DiffTab` sempre usa `MergeView` lado a lado e o cabeçalho reutiliza `.status-note`, cujo espaçamento é grande (`diff-tab.tsx`, `styles.css`). | Colunas estreitas, quebras excessivas e grande vazio antes do código. |
| Abas | `TabBar` usa uma faixa com `overflow-x:auto` e scrollbar nativa (`tab-bar.tsx`, `styles.css`). O clique do meio já fecha a aba no navegador testado. | Navegação visual datada; o gesto precisa de teste de regressão e tratamento do autoscroll do navegador. |
| Compilação | O botão é desabilitado por permissão, mutação pendente ou último build `queued/running` (`build-panel.tsx`). A troca de motor atualiza o projeto; a fila pode reutilizar um build antigo (`compile.service.ts` da API). No projeto inspecionado, o botão estava habilitado e o último build havia terminado. | O travamento relatado ainda exige reprodução; estado ativo persistente, fila e atualização do motor são hipóteses a investigar. A interface não explica como recuperar uma compilação demorada. |
| Mudanças | `ChangesView` é uma lista plana com badges A/M/D; o resumo da versão usa `.status-note`, criando muito espaço vazio (`changes-view.tsx`). | Leitura lenta e pouca semelhança com um fluxo de controle de versões moderno. |
| Comentários | A seleção só é consultada ao enviar o comentário; sem seleção, a ação pode simplesmente não prosseguir (`comments-panel.tsx`). `editor.tsx` já usa posições relativas do Yjs. | O usuário precisa selecionar texto, sair do editor e descobrir o fluxo no painel lateral; não há gesto direto para linha, palavra ou seção. |
| Escala do CSS | `styles.css` concentra mais de 2300 linhas e classes amplas são compartilhadas por telas distintas. | Ajustes locais causam efeitos inesperados em outras áreas. |

## Direção visual

- **Estrutura:** barra superior compacta, navegação lateral estável, editor e PDF como superfícies principais, painel inferior com altura ajustável e barra de estado sempre no limite inferior da janela.
- **Linguagem:** superfícies claras com contraste suave e bordas discretas; barras de ferramentas escuras ou neutras; azul para ação principal, âmbar para avisos e vermelho para erros. Estados não dependerão apenas da cor.
- **Tipografia:** fonte de interface legível e compacta, fonte monoespaçada no código, hierarquia curta de títulos. Remover textos informativos centrados que ocupam altura excessiva.
- **Densidade:** listas de arquivos, abas, mudanças e problemas devem mostrar informação útil sem grandes vazios; alvos interativos preservam tamanho adequado para toque.
- **Tokens e componentes:** cores, espaços, raios, sombras, foco, alturas de controle e estados definidos em um conjunto único de variáveis. Botões e modais compartilham variantes, comportamento e acessibilidade. Dropzone tem arrastar/soltar, clique, teclado, progresso e erro. Painel de membros deve ter hierarquia, papéis explicados e convite claro.
- **Arquivos:** ícones e cores por tipo (`.tex`, `.bib`, imagem, PDF, pasta), nomes truncados com caminho completo no tooltip e estados de seleção, modificação e erro visíveis.

## Plano de execução

### 0. Base visual e critérios de medição

1. Capturar telas de referência do estado atual em 320, 390, 768, 1140 e 1440 px, temas claro/escuro, conteúdo curto e longo.
2. Registrar os fluxos de abrir arquivos, alternar abas, diff, compilar, erros, comentários, mudanças, membros e upload.
3. Criar tokens de interface e separar estilos por área de forma incremental. Manter os componentes de botão, modal e dropzone como fonte única de padrões, revisando os usos antigos.
4. Medir overflow horizontal e vertical no `document`, posição da barra de estado e regiões roláveis de cada painel.

**Entrega:** referência visual e critérios objetivos para comparar as próximas etapas.

### 1. Layout, rolagem e responsividade — prioridade P0

1. Definir o workspace como uma área limitada a `100dvh`; aplicar `min-height:0`, `min-width:0` e `overflow` explícito nos ancestrais flex/grid até a região que deve rolar.
2. Dar altura efetiva e ajustável ao painel inferior; limitar seu conteúdo e deixar a rolagem apenas nos detalhes de compilação. A barra de estado permanece fora da área rolável.
3. Tratar independentemente a rolagem da árvore de arquivos, mudanças, comentários, editor, PDF e logs. Barras de rolagem não devem cobrir controles.
4. Em larguras pequenas, oferecer alternância clara entre editor/PDF, painel lateral em gaveta e ações prioritárias sempre acessíveis. Evitar colunas impraticáveis.
5. Revisar telas de projetos, membros, configurações e diálogos com os mesmos breakpoints.

**Aceite:** nas cinco larguras, não há rolagem horizontal da página; com log grande aberto, a altura rolável do documento não supera a janela, a barra de estado continua visível e somente o log rola; controles não ficam atrás de overlays.

### 2. Compilação confiável — prioridade P0

1. Reproduzir as sequências `pdfLaTeX → XeLaTeX → LuaLaTeX`, troca antes/durante/depois de um build, build falho e timeout. Registrar requisições, status, engine efetivo e tempo de cada job.
2. Distinguir na interface **salvando motor**, **na fila**, **compilando**, **concluído**, **falhou** e **demorando além do esperado**. Mostrar por que o botão está desabilitado, com tempo decorrido e ação de recuperação quando aplicável.
3. Garantir que a criação de um build use o motor visível e confirmado, que um job enfileirado com motor antigo não seja reaproveitado indevidamente e que estados terminais reabilitem o botão. Corrigir API/worker se a reprodução apontar fila ou processo órfão.
4. Revalidar status ao retornar para a aba ou reconectar; evitar estado de mutação ou cache preso. Tratar falhas de rede sem deixar o botão permanentemente bloqueado.
5. Organizar erros e avisos por arquivo com resumo compacto, filtro e salto para a linha; linhas longas quebram ou rolam dentro do painel.

**Aceite:** todas as sequências acima terminam em um estado explicável; após sucesso, falha ou timeout, é possível compilar novamente; engine do job corresponde à escolha confirmada. O defeito relatado deve ter um teste de regressão reproduzível antes de ser considerado resolvido.

### 3. Abas e comparação de versões — prioridade P1

1. Redesenhar a faixa de abas com ícone do tipo, título compacto, estado ativo, modificado e diff, botão de fechar visível no foco/hover e tooltip com caminho completo.
2. Preservar o clique do meio para fechar qualquer aba, evitar o autoscroll do navegador quando necessário e testar o gesto em navegador real. Adicionar rolagem por roda/trackpad, indicação de conteúdo oculto, navegação por teclado e rolagem automática até a aba ativa.
3. Trocar o cabeçalho alto do diff por uma barra compacta com arquivo, versões, aviso de instantâneo e ações. Oferecer modo unificado em espaços estreitos e lado a lado quando houver largura suficiente, com escolha manual do usuário.
4. Ajustar gutters, quebra de linha, placeholders de trechos iguais e cores para os dois temas; cada painel do diff deve rolar sem empurrar a página.

**Aceite:** abas longas continuam utilizáveis em 390/768 px; clique do meio fecha a aba escolhida; diff é legível sem corte em 768 px e mantém comparação lado a lado em 1440 px.

### 4. Mudanças com fluxo inspirado no VS Code — prioridade P1

1. Criar cabeçalho compacto com contador de arquivos e versão-base em uma linha, mais ações de atualizar e abrir histórico.
2. Mostrar mudanças agrupadas por pasta ou tipo, com ícones de arquivo, badges claros para adição/modificação/exclusão, nome e caminho sem quebras confusas.
3. Abrir o diff pelo item; revelar ações de abrir arquivo e descartar no foco/hover, mantendo acesso por teclado e toque. Dar confirmação clara ao descarte.
4. Fixar o campo de mensagem e a ação “Salvar versão” no rodapé do painel. Exibir estados vazio, carregando e erro com texto útil.
5. Considerar staging apenas depois de definir e implementar suporte real na API; o primeiro redesenho mantém a semântica atual de salvar todas as mudanças.

**Aceite:** mudanças podem ser localizadas, comparadas e salvas sem rolar por um bloco vazio; ações de arquivo e mensagem permanecem acessíveis em painéis estreitos.

### 5. Comentários ancorados no texto — prioridade P1

1. Exibir uma ação contextual “Comentar” após selecionar texto no editor e oferecer atalho de teclado e ação na margem da linha. O painel lateral pode continuar como lista de conversas.
2. Oferecer escopos explícitos: seleção livre, palavra, linha(s) e seção LaTeX. Para seção, definir regras para `\section`/`\subsection`, conteúdo até o próximo título de nível igual ou superior e casos sem título.
3. Congelar uma prévia da seleção ao iniciar o comentário, exibindo trecho, arquivo e linhas antes do envio. Se a seleção desaparecer ou mudar, explicar o estado e permitir refazer.
4. Persistir âncoras com as posições relativas do Yjs já usadas pelo editor; destacar o trecho ao abrir uma conversa e manter a referência após inserções/remoções colaborativas. Tratar arquivo excluído e âncora inválida.
5. Rever permissões, comentários resolvidos, contagem por arquivo e comportamento no toque.

**Aceite:** criar comentário de palavra, linha, múltiplas linhas e seção leva no máximo uma seleção/ação contextual; o trecho fica visível antes do envio e continua ligado ao texto após edições concorrentes em dois clientes.

### 6. Acabamento e integração — prioridade P2

1. Harmonizar ícones, botões, modais, dropzone, membros e formulários com os tokens. Revisar estados vazio, pendente, erro e sucesso.
2. Verificar acessibilidade: foco visível, ordem de tabulação, nomes de ações, contraste, `prefers-reduced-motion`, leitor de tela e alvos de toque.
3. Revisar textos de interface em português e consistência de termos (“motor”, “compilar”, “versão”, “alterações”).
4. Remover estilos globais conflitantes depois que cada tela migrar para classes próprias; preservar comportamentos existentes.

**Aceite:** componentes repetidos têm aparência e estados iguais; não há tela quebrada nos fluxos definidos na etapa 0.

## Verificação e sequência de entrega

| Lote | Escopo | Verificação principal |
| --- | --- | --- |
| A | Layout, rolagem, responsividade e logs | Navegador real nas cinco larguras; medir `scrollHeight`, posição do rodapé e scroll de cada painel. |
| B | Compilação e motor | Matriz dos três motores, fila, falha, timeout, reconexão; testes de API e componente para o caso reproduzido. |
| C | Abas, diff e mudanças | Clique do meio em navegador real, teclado, nomes longos, diff unificado/lado a lado, temas. |
| D | Comentários | Testes do escopo e das âncoras; dois clientes editando o mesmo arquivo. |
| E | Padrões visuais e telas secundárias | Capturas antes/depois, acessibilidade, `lint`, `typecheck`, testes e build do frontend. |

Cada lote só é concluído após revisão visual do produto no navegador, além dos testes. As capturas enviadas pelo usuário são casos de regressão obrigatórios. O problema da compilação permanece uma investigação até a sequência exata que o reproduz ser identificada.

## Andamento e entregas verificadas

Registro do que foi efetivamente executado e observado nesta sessão de implementação. O plano acima permanece como escrito; esta seção apenas acrescenta o estado atual.

### Verificado no navegador

- **Layout, logs e barra de estado:** medidos em 320, 390, 768, 1140 e 1440 px. Com o log aberto, a barra de estado permanece no limite inferior da janela e a rolagem fica contida no painel, sem rolagem da página inteira.
- **Responsividade do painel lateral:** gaveta móvel em funcionamento nas larguras pequenas.
- **Telas secundárias:** dashboard de projetos e modal de importação inspecionados em 390 e 1140 px.
- **Abas e diff:** clique do meio fecha a aba escolhida em navegador real; o diff responde à largura disponível.
- **Mudanças:** lista passou a ser apresentada agrupada.
- **Comentários:** ação contextual com escopos de palavra, linha e seção LaTeX; âncoras persistidas com as posições relativas do Yjs e exercitadas em duas abas (ver abaixo).
- **Acabamento:** ícones por tipo de arquivo, painel de membros, botões, modais e dropzone revisados segundo os padrões compartilhados.

### Compilação

O fluxo de compilação foi robustecido e o defeito relatado deixou de ser hipótese: foi reproduzido. A cadeia observada era o `PATCH` do motor não devolver o `role` na resposta, o cache descartar a permissão do usuário e o botão **Compilar** ficar travado em consequência. A correção foi aplicada na API e no frontend e retestada no navegador alternando entre XeLaTeX e LuaLaTeX.

Em seguida foi executada uma **compilação real com XeLaTeX** no navegador: o build percorreu fila e execução, terminou em **sucesso** após cerca de 50 s e o botão **Compilar** voltou a ficar habilitado ao final, permanecendo desabilitado durante todo o processo. Essa rodada expôs um defeito de UX no contador da barra de estado: como o objeto do build não muda entre as consultas, o rótulo ficava congelado em `Compilando… (2s)` durante quase todo o build. O painel passou a ter um tique de 1 s enquanto o build está na fila ou em execução — ativo só nesse período — de modo que o contador, o `title` do botão e a passagem para **Tentar novamente** acompanhem o relógio; há teste de regressão com timers falsos.

### Matriz dos três motores — QA real

A matriz foi exercitada em um mesmo projeto real, o projeto de mestrado `dorgs`, um motor por rodada. O XeLaTeX foi acionado pela interface, no navegador; LuaLaTeX e pdfLaTeX foram disparados pela API local, sem passar pela interface:

| Motor | Status | Código de saída | Duração | O que o log aponta |
| --- | --- | --- | --- | --- |
| XeLaTeX | `succeeded` | 0 | ~47 s | Compilação completa. |
| LuaLaTeX | `failed` | 12 | ~25 s | Fonte `lmroman12-regular` indisponível na instalação local. |
| pdfLaTeX | `failed` | 12 | ~4 s | O projeto usa `fontspec`, que exige XeTeX ou LuaTeX. |

As duas falhas vêm do **conteúdo do projeto e da instalação local de TeX**, não do fluxo de compilação: nas três rodadas houve job criado com o motor correto, o build chegou a um estado terminal, o botão voltou a ficar disponível ao final e o motor foi restaurado para `xelatex` depois do teste. O backend em execução durante o QA ainda devolvia o `PATCH` sem `role` (o processo não foi reiniciado com a correção da API) e, mesmo assim, a permissão de edição se manteve — o merge defensivo do frontend sustentou o caso na prática.

A rodada também mostrou que essas duas falhas chegam à interface **sem erro estruturado** (`errors` vazio): o painel respondia "0 erros", "sem problemas" e "Compilado sem erros ou avisos" a um build que havia falhado. O painel de detalhes passou a declarar o desfecho — status e código de saída, quando houver — e a remeter ao **ver log completo**; o selo verde só aparece em build bem-sucedido. As contagens e os filtros continuam fiéis ao que a API extraiu e nenhum erro é inventado. Há teste de regressão para falha e timeout com `errors` vazio, com e sem avisos.

### Comentários com dois clientes — QA real

O cenário colaborativo do aceite da etapa 5 foi ensaiado agora, em um projeto temporário criado para o teste, com duas abas abertas no mesmo arquivo:

1. Um comentário foi criado sobre `\documentclass` em `main.tex` na primeira aba e apareceu na segunda.
2. Ao inserir um prefixo antes da palavra comentada na primeira aba, o destaque **local** ficou deslocado — a segunda aba já mostrava a posição correta.

A causa era o `commentHighlights` resolver as âncoras dentro da própria transação, antes de o `Y.Text` acompanhar a edição. O campo passou a mapear as decorações pelo conjunto de mudanças da transação e a pedir uma re-resolução depois que o `Y.Text` sincroniza. Em novo teste nas duas abas, inserir `MORE ` antes da palavra comentada deixou o destaque sobre a palavra correta **nas duas abas**.

Isso cobre o aceite para este cenário — uma edição local à frente da âncora, propagada entre dois clientes — e não para toda concorrência possível (edições simultâneas nas duas abas, conflitos e reconexão seguem sem ensaio manual). O projeto temporário e as abas foram removidos ao final; nenhum artefato de QA ficou no banco. No automatizado, `apps/web/src/components/editor-comments.test.ts` tem 6 testes cobrindo inserção local, inserção remota, exclusão do trecho citado, coalescência de rajadas de edição e dispatch após destruição da view.

### Limites conhecidos — pendente de QA

Seguem abertos, após a rodada acima:

1. **PDF dos motores que falharam.** Só o XeLaTeX gerou PDF verificável. Como as falhas de LuaLaTeX e pdfLaTeX vêm da fonte ausente e do `fontspec`, essa verificação depende de instalar a fonte faltante ou de usar um projeto sem `fontspec`.
2. **Timeout real e troca de motor durante o build.** Nenhum build atingiu o timeout de verdade, e nenhuma troca de motor foi feita com compilação em andamento; os dois caminhos só têm cobertura de teste automatizado.
3. **Correção da API com o processo reiniciado.** O backend local em execução ainda é o antigo: o `PATCH` não devolveu `role`. A fonte já está corrigida e buildada, mas o processo não foi reiniciado, então a resposta corrigida não foi observada em execução.

A aceitação end-to-end desses pontos depende de uma rodada de QA dedicada.

### Checks

Rodada final no monorepo, toda passando:

| Check | Resultado |
| --- | --- |
| `pnpm lint` | 251 arquivos verificados. |
| `pnpm typecheck` | 6 pacotes sem erro. |
| `pnpm test` | 51 arquivos, 249 testes passando, 2 ignorados. |
| `pnpm build` | todos os pacotes. |
| `git diff --check` | sem erros de espaço em branco. |

Na alteração do painel de compilação descrita acima: `apps/web/src/components/build-panel.test.tsx` passou (11 testes), `tsc --noEmit` em `apps/web` sem erros e `biome check` limpo nos dois arquivos tocados.

### Situação geral

O trabalho avançou em todas as frentes do plano e os checks finais estão fechados, mas o plano **não deve ser considerado concluído**: os três limites acima seguem pendentes de QA e precisam ser resolvidos antes de dar os lotes B e D por encerrados.
