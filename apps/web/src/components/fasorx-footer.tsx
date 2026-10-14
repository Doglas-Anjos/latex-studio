const SEP = (
  <span className="fasorx-footer-sep" aria-hidden="true">
    ·
  </span>
);

/** Footer for the dashboard (the editor workspace has its own status bar). The source link is
 * always shown (AGPL §13); the FasorX copyright and notice only on instances behind FasorX. */
export function FasorxFooter() {
  const fasorx = Boolean(import.meta.env.VITE_FASORX_URL);
  return (
    <footer className="fasorx-footer">
      {fasorx && (
        <>
          <span>© {new Date().getFullYear()} FasorX</span>
          {SEP}
          <a href="https://fasorx.com.br/privacidade/" target="_blank" rel="noreferrer">
            Cookies e dados
          </a>
          {SEP}
          <a href="https://fasorx.com.br" target="_blank" rel="noreferrer">
            fasorx.com.br
          </a>
          {SEP}
        </>
      )}
      <a href="https://github.com/Doglas-Anjos/latex-studio" target="_blank" rel="noreferrer">
        Código-fonte
      </a>
    </footer>
  );
}
