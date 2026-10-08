import type { CompletionSource } from '@codemirror/autocomplete';
import { LanguageSupport } from '@codemirror/language';
import { styleTags, Tag, tags as t } from '@lezer/highlight';
import { latex, latexLanguage } from 'codemirror-lang-latex';

/** Tags the stock LaTeX grammar does not give: what a command's argument means. */
export const latexTags = {
  packageName: Tag.define(),
  option: Tag.define(),
  sectionTitle: Tag.define(),
  mathCommand: Tag.define(),
  userCommand: Tag.define(),
  path: Tag.define(),
};

/**
 * The stock grammar only colours the control sequence (`\section`, `\usepackage`, `\ref`), so
 * every argument reads as plain text. These rules colour the argument by role.
 */
const argumentStyles = styleTags({
  'DocumentClassArgument/... PackageArgument/...': latexTags.packageName,
  'OptionalArgument/ShortOptionalArg/...': latexTags.option,
  'SectioningArgument/...': latexTags.sectionTitle,
  'RefArgument/... LabelArgument/... BibKeyArgument/...': t.labelName,
  'UrlArgument/...': t.url,
  'TextBoldCommand/TextArgument/...': t.strong,
  'EmphasisCommand/TextArgument/... TextItalicCommand/TextArgument/...': t.emphasis,
  'MathCommand/... MathCtrlSeq': latexTags.mathCommand,
  'UnknownCommand/CtrlSeq': latexTags.userCommand,
  'Input/... Include/... IncludeGraphics/...': latexTags.path,
});

const language = latexLanguage.configure({ props: [argumentStyles] });

/**
 * `latex()` with argument-aware highlighting. The stock missing-ref/cite linters stay off (they
 * false-alarm per file); `autocomplete`, when given, adds a \ref/\cite key completion source.
 */
export function latexSupport(opts?: { autocomplete?: CompletionSource }): LanguageSupport {
  // Multi-file projects: a chapter has no \begin{document}, and its \ref/\cite targets live in
  // other files, so those checks only produce false alarms; the compiler reports the real ones.
  const support = latex({
    // Its autocompletion sets `override`, which drops every language-data source (ours included).
    // Off: lang-latex still registers its own source as language data, and basicSetup's
    // autocompletion (no override) then queries both the stock commands and our \ref/\cite keys.
    enableAutocomplete: false,
    linter: {
      checkMissingDocumentEnv: false,
      checkMissingReferences: false,
      checkCitesWithoutBibliography: false,
      checkMissingPackages: false,
    },
  }).support;
  const extra = opts?.autocomplete ? [language.data.of({ autocomplete: opts.autocomplete })] : [];
  return new LanguageSupport(language, [support, ...extra]);
}
