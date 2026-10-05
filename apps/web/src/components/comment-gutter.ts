import { type EditorView, GutterMarker, gutter } from '@codemirror/view';

/**
 * One "+" button per line, visible on hover/touch (`styles.css`), to start a
 * line comment without selecting anything first. Excluded from the tab
 * order: with hundreds of lines this would be unusable by keyboard, which
 * instead uses the shortcut bound in `commentKeymap`.
 */
class CommentLineMarker extends GutterMarker {
  constructor(
    private readonly line: number,
    private readonly onClick: (line: number) => void,
  ) {
    super();
  }

  override eq(other: CommentLineMarker) {
    return other.line === this.line;
  }

  override toDOM() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.className = 'cm-comment-line-btn';
    btn.textContent = '+';
    btn.setAttribute('aria-label', `Comentar linha ${this.line}`);
    btn.title = `Comentar linha ${this.line}`;
    // Keep the editor's own selection/focus; this is a separate action, not a caret move.
    btn.onmousedown = (event) => event.preventDefault();
    btn.onclick = () => this.onClick(this.line);
    return btn;
  }
}

export function commentGutter(onComment: (line: number) => void) {
  return gutter({
    class: 'cm-comment-gutter',
    lineMarker(view: EditorView, line) {
      return new CommentLineMarker(view.state.doc.lineAt(line.from).number, onComment);
    },
  });
}
