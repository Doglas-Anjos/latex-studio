/** Wordmark set the way LaTeX itself typesets its name: raised small "a", dropped small "e". */
export function Brand() {
  return (
    <span className="brand-mark">
      L<span className="brand-a">a</span>T<span className="brand-e">e</span>X
      <span className="brand-suffix"> Studio</span>
    </span>
  );
}
