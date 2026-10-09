# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in latex-studio, please report it responsibly by creating a **private security advisory** on GitHub:

1. Go to the **Security** tab of this repository
2. Click **Report a vulnerability**
3. Describe the issue, impact, and steps to reproduce
4. Submit the report

**Do not** open a public issue or pull request for security vulnerabilities.

## Response Timeline

We will acknowledge your report within 7 days and provide updates on the remediation status. Critical vulnerabilities may be prioritized for faster resolution.

## Known accepted advisories

`pnpm audit` is configured (in `package.json` → `pnpm.auditConfig.ignoreGhsas`) to ignore the
following advisories, after review:

- **nanoid < 3.3.18** — GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8, GHSA-xwg4-73v4-xw9w
  (same issues as CVE-2026-67213, CVE-2026-67214, CVE-2026-73086).
  These are denial-of-service / predictable-id bugs triggered by calling `nanoid()` with a negative,
  zero or overflowing size. The only path to it is the transitive `hunspell-asm > emscripten-wasm-loader`,
  whose single call site is `nanoid(45)` — a fixed, positive constant, run server-side and never
  from user input, so none of the bugs are reachable. There is no safe upgrade: `emscripten-wasm-loader`
  requires nanoid 2.x's function-style default export, which nanoid 3.x removed, so forcing the patched
  line breaks the spell checker. Revisit when `hunspell-asm` moves off nanoid 2.x.
  Suppressed in `pnpm-workspace.yaml` (`pnpm audit`) and `.trivyignore` (the image scan).

## Supported Versions

| Version | Supported |
|---------|-----------|
| main    | ✅ Yes    |
| older   | ❌ No     |

Only the main branch is actively maintained. We recommend always running the latest version.
