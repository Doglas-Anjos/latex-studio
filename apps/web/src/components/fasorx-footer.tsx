/** The platform footer shared across FasorX apps: copyright, the data/cookies notice, and a link
 * back to the hub. Kept to the dashboard; the editor workspace has its own status bar instead. */
export function FasorxFooter() {
  return (
    <footer className="fasorx-footer">
      <span>© {new Date().getFullYear()} FasorX</span>
      <a href="https://fasorx.com.br/privacidade/" target="_blank" rel="noreferrer">
        Cookies e dados
      </a>
      <a href="https://fasorx.com.br" target="_blank" rel="noreferrer">
        fasorx.com.br
      </a>
    </footer>
  );
}
