export interface PaletteItem {
  /** What the button shows (rendered by KaTeX). */
  tex: string;
  /** What is inserted; defaults to `tex`. Templates use empty `{}` slots. */
  insert?: string;
  title: string;
}

// One item per line: `tex @ description @ insert?`. In `insert`, ¶ is a newline. The title shown
// is "description (insert or tex)".
const SOURCE: [id: string, name: string, lines: string][] = [
  [
    'greek',
    'Gregas',
    String.raw`
\alpha @ Alfa
\beta @ Beta
\gamma @ Gama
\delta @ Delta
\epsilon @ Épsilon
\zeta @ Zeta
\eta @ Eta
\theta @ Teta
\iota @ Iota
\kappa @ Capa
\lambda @ Lambda
\mu @ Mi
\nu @ Ni
\xi @ Csi
\pi @ Pi
\rho @ Rô
\sigma @ Sigma
\tau @ Tau
\upsilon @ Ípsilon
\phi @ Fi
\chi @ Qui
\psi @ Psi
\omega @ Ômega
\varepsilon @ Épsilon variante
\vartheta @ Teta variante
\varpi @ Pi variante
\varrho @ Rô variante
\varsigma @ Sigma final
\varphi @ Fi variante
\Gamma @ Gama maiúsculo
\Delta @ Delta maiúsculo
\Theta @ Teta maiúsculo
\Lambda @ Lambda maiúsculo
\Xi @ Csi maiúsculo
\Pi @ Pi maiúsculo
\Sigma @ Sigma maiúsculo
\Upsilon @ Ípsilon maiúsculo
\Phi @ Fi maiúsculo
\Psi @ Psi maiúsculo
\Omega @ Ômega maiúsculo
`,
  ],
  [
    'ops',
    'Operadores',
    String.raw`
+ @ Mais
- @ Menos
\times @ Vezes
\div @ Dividido
\pm @ Mais ou menos
\mp @ Menos ou mais
\cdot @ Ponto central
\circ @ Composição
\ast @ Asterisco
\star @ Estrela
\oplus @ Soma direta
\ominus @ Menos circulado
\otimes @ Produto tensorial
\odot @ Ponto circulado
\cap @ Interseção
\cup @ União
\wedge @ E lógico
\vee @ Ou lógico
\ltimes @ Semidireto à esquerda
\rtimes @ Semidireto à direita
\setminus @ Diferença de conjuntos
\wr @ Produto em coroa
\bullet @ Bolinha
\uplus @ União disjunta
\sqcap @ Interseção quadrada
\sqcup @ União quadrada
\amalg @ Coproduto
\diamond @ Losango
\dagger @ Adaga
\ddagger @ Adaga dupla
`,
  ],
  [
    'rel',
    'Relações',
    String.raw`
= @ Igual
\neq @ Diferente
< @ Menor
> @ Maior
\leq @ Menor ou igual
\geq @ Maior ou igual
\ll @ Muito menor
\gg @ Muito maior
\approx @ Aproximadamente
\equiv @ Equivalente
\cong @ Congruente
\sim @ Semelhante
\simeq @ Assintoticamente igual
\propto @ Proporcional
\subset @ Subconjunto
\supset @ Superconjunto
\subseteq @ Subconjunto ou igual
\supseteq @ Superconjunto ou igual
\in @ Pertence
\notin @ Não pertence
\ni @ Contém
\perp @ Perpendicular
\parallel @ Paralelo
\vdash @ Prova
\models @ Modela
\prec @ Precede
\succ @ Sucede
\preceq @ Precede ou igual
\succeq @ Sucede ou igual
\mid @ Divide
\nmid @ Não divide
\doteq @ Igual com ponto
\leqslant @ Menor ou igual inclinado
\geqslant @ Maior ou igual inclinado
\triangleq @ Igual por definição
\nless @ Não menor
\ngtr @ Não maior
\not\equiv @ Não equivalente
\asymp @ Assintótico
`,
  ],
  [
    'arrows',
    'Setas',
    String.raw`
\to @ Seta para
\gets @ Seta de volta
\leftarrow @ Seta para a esquerda
\rightarrow @ Seta para a direita
\leftrightarrow @ Seta dupla horizontal
\Leftarrow @ Seta dupla para a esquerda
\Rightarrow @ Seta dupla para a direita
\Leftrightarrow @ Seta dupla bidirecional
\longrightarrow @ Seta longa para a direita
\Longrightarrow @ Seta dupla longa para a direita
\Longleftrightarrow @ Seta dupla longa bidirecional
\mapsto @ Mapeia para
\longmapsto @ Mapeia para longa
\uparrow @ Seta para cima
\downarrow @ Seta para baixo
\updownarrow @ Seta vertical dupla
\Uparrow @ Seta dupla para cima
\Downarrow @ Seta dupla para baixo
\nearrow @ Seta nordeste
\searrow @ Seta sudeste
\swarrow @ Seta sudoeste
\nwarrow @ Seta noroeste
\hookrightarrow @ Inclusão gancho à direita
\hookleftarrow @ Gancho à esquerda
\rightharpoonup @ Arpão para a direita
\rightleftharpoons @ Equilíbrio
\xrightarrow{f} @ Seta com rótulo à direita @ \xrightarrow{}
\xleftarrow{f} @ Seta com rótulo à esquerda @ \xleftarrow{}
\iff @ Se e somente se
\implies @ Implica
\impliedby @ É implicado por
`,
  ],
  [
    'sets',
    'Conjuntos e lógica',
    String.raw`
\forall @ Para todo
\exists @ Existe
\nexists @ Não existe
\neg @ Negação
\emptyset @ Conjunto vazio
\varnothing @ Conjunto vazio variante
\mathbb{N} @ Naturais
\mathbb{Z} @ Inteiros
\mathbb{Q} @ Racionais
\mathbb{R} @ Reais
\mathbb{C} @ Complexos
\infty @ Infinito
\aleph @ Álefe
\therefore @ Portanto
\because @ Pois
\top @ Topo verdadeiro
\bot @ Base falso
\subsetneq @ Subconjunto próprio
\supsetneq @ Superconjunto próprio
`,
  ],
  [
    'big',
    'Grandes operadores',
    String.raw`
\sum @ Somatório
\prod @ Produtório
\coprod @ Coproduto
\int @ Integral
\iint @ Integral dupla
\iiint @ Integral tripla
\oint @ Integral de linha fechada
\bigcup @ União grande
\bigcap @ Interseção grande
\bigoplus @ Soma direta grande
\bigotimes @ Produto tensorial grande
\bigvee @ Ou lógico grande
\bigwedge @ E lógico grande
\sum_{i=1}^{n} @ Somatório com limites @ \sum_{}^{}
\prod_{i=1}^{n} @ Produtório com limites @ \prod_{}^{}
\int_{a}^{b} @ Integral com limites @ \int_{}^{}
\lim_{x \to a} @ Limite @ \lim_{}
\max_{x} @ Máximo @ \max_{}
\min_{x} @ Mínimo @ \min_{}
\sup_{x} @ Supremo @ \sup_{}
\inf_{x} @ Ínfimo @ \inf_{}
`,
  ],
  [
    'struct',
    'Estruturas',
    String.raw`
\frac{a}{b} @ Fração @ \frac{}{}
\dfrac{a}{b} @ Fração grande @ \dfrac{}{}
\tfrac{a}{b} @ Fração pequena @ \tfrac{}{}
\sqrt{x} @ Raiz quadrada @ \sqrt{}
\sqrt[n]{x} @ Raiz n-ésima @ \sqrt[]{}
x^{n} @ Potência expoente @ ^{}
x_{n} @ Índice subscrito @ _{}
x_{i}^{n} @ Índice e expoente @ _{}^{}
\binom{n}{k} @ Coeficiente binomial @ \binom{}{}
\overline{x} @ Barra superior @ \overline{}
\underline{x} @ Sublinhado @ \underline{}
\overbrace{abc}^{n} @ Chave superior @ \overbrace{}^{}
\underbrace{abc}_{n} @ Chave inferior @ \underbrace{}_{}
\left( x \right) @ Parênteses ajustáveis @ \left(  \right)
\left[ x \right] @ Colchetes ajustáveis @ \left[  \right]
\left| x \right| @ Módulo ajustável @ \left|  \right|
\left\langle x \right\rangle @ Ângulos ajustáveis @ \left\langle  \right\rangle
\lVert x \rVert @ Norma @ \lVert  \rVert
\frac{d}{dx} @ Derivada @ \frac{d}{dx}
\frac{\partial}{\partial x} @ Derivada parcial @ \frac{\partial}{\partial x}
\frac{\partial^2 f}{\partial x^2} @ Derivada parcial segunda @ \frac{\partial^2 }{\partial x^2}
\begin{cases} a & b \\ c & d \end{cases} @ Casos @ \begin{cases}¶  & \\¶  & ¶\end{cases}
\stackrel{a}{=} @ Símbolo sobre símbolo @ \stackrel{}{}
\overset{a}{=} @ Símbolo acima @ \overset{}{}
\underset{a}{=} @ Símbolo abaixo @ \underset{}{}
\boxed{x} @ Caixa @ \boxed{}
x \pmod{n} @ Módulo congruência @ \pmod{}
`,
  ],
  [
    'accents',
    'Acentos',
    String.raw`
\hat{a} @ Chapéu @ \hat{}
\widehat{abc} @ Chapéu largo @ \widehat{}
\bar{a} @ Barra @ \bar{}
\vec{a} @ Vetor @ \vec{}
\overrightarrow{AB} @ Seta larga @ \overrightarrow{}
\dot{a} @ Ponto @ \dot{}
\ddot{a} @ Dois pontos @ \ddot{}
\tilde{a} @ Til @ \tilde{}
\widetilde{abc} @ Til largo @ \widetilde{}
\acute{a} @ Agudo @ \acute{}
\grave{a} @ Grave @ \grave{}
\breve{a} @ Breve @ \breve{}
\check{a} @ Háček @ \check{}
\mathring{a} @ Anel @ \mathring{}
`,
  ],
  [
    'func',
    'Funções',
    String.raw`
\sin @ Seno
\cos @ Cosseno
\tan @ Tangente
\cot @ Cotangente
\sec @ Secante
\csc @ Cossecante
\arcsin @ Arco seno
\arccos @ Arco cosseno
\arctan @ Arco tangente
\sinh @ Seno hiperbólico
\cosh @ Cosseno hiperbólico
\tanh @ Tangente hiperbólica
\log @ Logaritmo
\ln @ Logaritmo natural
\exp @ Exponencial
\lim @ Limite
\limsup @ Limite superior
\liminf @ Limite inferior
\max @ Máximo
\min @ Mínimo
\sup @ Supremo
\inf @ Ínfimo
\det @ Determinante
\dim @ Dimensão
\ker @ Núcleo
\gcd @ Máximo divisor comum
\deg @ Grau
\arg @ Argumento
\Pr @ Probabilidade
\hom @ Homomorfismos
`,
  ],
  [
    'fonts',
    'Fontes',
    String.raw`
\mathbf{Ab} @ Negrito @ \mathbf{}
\mathit{Ab} @ Itálico @ \mathit{}
\mathrm{Ab} @ Romano @ \mathrm{}
\mathsf{Ab} @ Sem serifa @ \mathsf{}
\mathtt{Ab} @ Máquina de escrever @ \mathtt{}
\mathcal{A} @ Caligráfico @ \mathcal{}
\mathbb{R} @ Quadro-negro @ \mathbb{}
\mathfrak{g} @ Fraktur @ \mathfrak{}
\boldsymbol{\alpha} @ Símbolo em negrito @ \boldsymbol{}
\text{texto} @ Texto normal @ \text{}
\operatorname{op} @ Operador nomeado @ \operatorname{}
`,
  ],
  [
    'misc',
    'Diversos',
    String.raw`
\partial @ Derivada parcial
\nabla @ Nabla
\hbar @ h cortado
\ell @ L cursivo
\Re @ Parte real
\Im @ Parte imaginária
\wp @ P de Weierstrass
\prime @ Linha primo
\angle @ Ângulo
\measuredangle @ Ângulo medido
\triangle @ Triângulo
\square @ Quadrado
^{\circ} @ Grau @ ^{\circ}
\cdots @ Reticências centrais
\ldots @ Reticências baixas
\vdots @ Reticências verticais
\ddots @ Reticências diagonais
\checkmark @ Marca de verificação
\clubsuit @ Paus
\diamondsuit @ Ouros
\heartsuit @ Copas
\spadesuit @ Espadas
\flat @ Bemol
\natural @ Bequadro
\sharp @ Sustenido
a\,b @ Espaço fino @ \,
a\:b @ Espaço médio @ \:
a\;b @ Espaço grosso @ \;
a\quad b @ Espaço de um quadratim @ \quad
a\qquad b @ Espaço de dois quadratins @ \qquad
a\!b @ Espaço negativo @ \!
`,
  ],
];

export const MATH_PALETTE: { id: string; name: string; items: PaletteItem[] }[] = SOURCE.map(
  ([id, name, lines]) => ({
    id,
    name,
    items: lines
      .trim()
      .split('\n')
      .map((line) => {
        const [tex = '', desc = '', ins] = line.split(' @ ').map((s) => s.trim());
        const insert = ins?.replaceAll('¶', '\n');
        const title = `${desc} (${insert ?? tex})`;
        return insert === undefined ? { tex, title } : { tex, insert, title };
      }),
  }),
);
