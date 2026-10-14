# Third-party notices

latex-studio itself is AGPL-3.0-only (see `LICENSE`). It redistributes the following third-party
material, each under its own license. Other npm dependencies are installed from the registry
and carry their own licenses in `node_modules`.

## Vendored in the repository (`.claude/`)

| Material | Source | License | Copyright |
|---|---|---|---|
| `.claude/skills/vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT (declared in the skill's `SKILL.md` frontmatter; the upstream repository has no LICENSE file) | Vercel, Inc. |
| `.claude/skills/vercel-composition-patterns` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT (declared in the skill's `SKILL.md` frontmatter; the upstream repository has no LICENSE file) | Vercel, Inc. |
| `.claude/skills/nestjs-best-practices` | [kadajett/agent-nestjs-skills](https://github.com/kadajett/agent-nestjs-skills) | MIT (declared in the skill's `SKILL.md` frontmatter; the upstream repository has no LICENSE file) | Kadajett |
| `.claude/skills/frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0, full text in `.claude/skills/frontend-design/LICENSE.txt` | Anthropic, PBC |
| `.claude/skills/ponytail-review`, `.claude/rules/ponytail.md` | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | MIT | Copyright (c) 2026 DietrichGebert |

MIT License text (applies to the MIT rows above, with the copyright holder shown in each row):

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Bundled in the web build (`apps/web`)

| Package | License | Copyright |
|---|---|---|
| `@fontsource/fira-code` (Fira Code) | OFL-1.1 | 2014-2020 The Fira Code Project Authors |
| `@fontsource/ibm-plex-mono`, `@fontsource/ibm-plex-sans` (IBM Plex) | OFL-1.1 | 2017, 2019 IBM Corp. |
| `@fontsource/jetbrains-mono` (JetBrains Mono) | OFL-1.1 | 2020 The JetBrains Mono Project Authors |
| `pdfjs-dist` (PDF.js) | Apache-2.0 | Mozilla Foundation and contributors |
| `katex` | MIT | 2013-2020 Khan Academy and other contributors |

The SIL Open Font License 1.1 is at <https://openfontlicense.org>; each font package ships its
`LICENSE` file.

## Spell-check dictionaries (API image)

| Package | License | Notes |
|---|---|---|
| `dictionary-pt` | LGPL-3.0 OR MPL-2.0 | VERO dictionary, Raimundo Moura and team |
| `dictionary-en` | MIT AND BSD | Derived from SCOWL, Kevin Atkinson; see the package's `license` file |
