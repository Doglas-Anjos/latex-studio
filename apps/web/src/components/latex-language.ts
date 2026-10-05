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

/** `latex()` with argument-aware highlighting; completion and auto-close stay the stock ones. */
export function latexSupport(): LanguageSupport {
  // Multi-file projects: a chapter has no \begin{document}, and its \ref/\cite targets live in
  // other files, so those checks only produce false alarms; the compiler reports the real ones.
  const support = latex({
    linter: {
      checkMissingDocumentEnv: false,
      checkMissingReferences: false,
      checkCitesWithoutBibliography: false,
      checkMissingPackages: false,
    },
  }).support;
  return new LanguageSupport(language, support);
}
