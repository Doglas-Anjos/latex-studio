export type LogEntry = { file?: string; line?: number; message: string };

// No leading `\s*`: unanchored, it rescans a run of spaces from each of its positions (quadratic on
// the 10000-char lines max_print_line allows). The message is trimmed after the replace anyway.
const ON_LINE = /on input line (\d+)\.?$/;
const MAX_ENTRIES = 1000;

export type ParsedLog = { errors: LogEntry[]; warnings: LogEntry[]; info: LogEntry[] };

/** Is a `! ` / `file:line:` error followed by TeX's `l.<n>` context? Those halt or need recovery. */
function hasContext(lines: string[], from: number): boolean {
  for (const l of lines.slice(from + 1, from + 20)) {
    if (/^l\.\d+/.test(l)) return true;
    if (l.startsWith('! ') || /^\S[^:]*?:\d+: /.test(l)) return false;
  }
  return false;
}

export function parseLatexLog(log: string): ParsedLog {
  const errors: LogEntry[] = [];
  const warnings: LogEntry[] = [];
  const info: LogEntry[] = [];
  // One entry per open "(": the innermost file at that depth, so a plain "(" repeats its parent's
  // file and the current file is the top, not a search down a stack that every "(" grows.
  const stack: Array<string | undefined> = [];
  const withFile = (): { file?: string } => {
    const file = stack.at(-1);
    return file === undefined ? {} : { file };
  };
  const lines = log.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';

    // `-file-line-error` format: `./chapters/intro.tex:12: Undefined control sequence.`
    const [, locFile, locLine, locMessage] =
      /^((?:[A-Za-z]:)?[^:\s][^:]*?):(\d+): (.*)$/.exec(text) ?? [];
    if (locFile && locLine && locMessage?.trim() && !locMessage.trim().startsWith('==>')) {
      const entry = { file: locFile, line: Number(locLine), message: locMessage.trim() };
      // TeX recovered on its own (e.g. "Infinite glue shrinkage" while splitting a box): no
      // `l.<n>` context follows and the run goes on, so it is a warning, as Overleaf shows it.
      // An explicit `... Error` is always an error, even when its help text pushes `l.<n>` out of view.
      (hasContext(lines, i) || /\bError\b/.test(entry.message) ? errors : warnings).push(entry);
      continue;
    }

    if (text.startsWith('! ')) {
      const entry: LogEntry = { message: text.slice(2).trim(), ...withFile() };
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const next = lines[j] ?? '';
        const m = /^l\.(\d+)/.exec(next);
        if (m) {
          entry.line = Number(m[1]);
          break;
        }
        if (next.startsWith('! ')) break;
      }
      errors.push(entry);
      continue;
    }

    const warn = /^(?:LaTeX|Package (\S+)|Class (\S+)) Warning: (.*)$/.exec(text);
    if (warn) {
      const tag = warn[1] ?? warn[2];
      let message = warn[3] ?? '';
      // continuation: next line starts with "(pkg)" for packages, or plain text for LaTeX
      for (let j = i + 1; j < Math.min(i + 5, lines.length) && !ON_LINE.test(message); j++) {
        const next = lines[j] ?? '';
        // startsWith, not a RegExp: the tag comes from the log, so `(a|a)*b` would backtrack forever.
        const cont = tag
          ? next.startsWith(`(${tag})`) && next.slice(tag.length + 2).trim()
          : next.trim();
        if (!cont || (!tag && /^(!|\(|[A-Za-z]+ Warning:)/.test(next))) break;
        message += ` ${cont.trim()}`;
        i = j;
      }
      const m = ON_LINE.exec(message);
      warnings.push({
        ...withFile(),
        message: message.replace(ON_LINE, '').trim(),
        ...(m && { line: Number(m[1]) }),
      });
      continue;
    }

    const box =
      /^((?:Over|Under)full \\[hv]box .*?) (?:in paragraph |detected )?at lines? (\d+)/.exec(text);
    if (box) {
      info.push({ ...withFile(), line: Number(box[2]), message: box[1] as string });
      continue;
    }
    if (/^(l\.\d+|Overfull|Underfull)/.test(text)) continue;

    // TeX Live 2026 reports errors it recovered from without file or line, followed by whatever
    // the page builder printed next: `ignored: Infinite glue shrinkage … [2] [3] (out/main.aux)`.
    const ignored = /^ignored(?: error)?: (.{1,300}?)(?=\s+[[(]|$)/.exec(text);
    if (ignored) warnings.push({ ...withFile(), message: (ignored[1] as string).trim() });

    for (const m of text.matchAll(/\(([^\s()]*)|\)/g)) {
      if (m[0] === ')') stack.pop();
      else stack.push(/^(\.{0,2}\/|[A-Za-z]:)|\.\w+$/.test(m[1] ?? '') ? m[1] : stack.at(-1));
    }
  }
  // A runaway document can log hundreds of thousands of warnings; the first ones are what matter.
  return {
    errors: errors.slice(0, MAX_ENTRIES),
    warnings: warnings.slice(0, MAX_ENTRIES),
    info: info.slice(0, MAX_ENTRIES),
  };
}
