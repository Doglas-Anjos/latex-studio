export type LogEntry = { file?: string; line?: number; message: string };

const ON_LINE = /\s*on input line (\d+)\.?$/;

export function parseLatexLog(log: string): { errors: LogEntry[]; warnings: LogEntry[] } {
  const errors: LogEntry[] = [];
  const warnings: LogEntry[] = [];
  // open files; undefined = a plain "(" that is not a file
  const stack: Array<string | undefined> = [];
  const withFile = (): { file?: string } => {
    const file = stack.findLast((f) => f !== undefined);
    return file === undefined ? {} : { file };
  };
  const lines = log.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';

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
        const cont = tag ? new RegExp(`^\\(${tag}\\)\\s+(.*)`).exec(next)?.[1] : next.trim();
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

    if (/^(l\.\d+|Overfull|Underfull)/.test(text)) continue;

    for (const m of text.matchAll(/\(([^\s()]*)|\)/g)) {
      if (m[0] === ')') stack.pop();
      else stack.push(/^(\.{0,2}\/|[A-Za-z]:)|\.\w+$/.test(m[1] ?? '') ? m[1] : undefined);
    }
  }
  return { errors, warnings };
}
