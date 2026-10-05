import * as Y from 'yjs';

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const encodeAnchorPos = (ytext: Y.Text, index: number) =>
  toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, index)));

/** Absolute index of a stored relative position, or null if it no longer resolves. */
export function resolveAnchorPos(ytext: Y.Text, b64: string): number | null {
  try {
    const abs = ytext.doc
      ? Y.createAbsolutePositionFromRelativePosition(
          Y.decodeRelativePosition(fromBase64(b64)),
          ytext.doc,
        )
      : null;
    return abs && abs.type === ytext ? abs.index : null;
  } catch {
    return null;
  }
}
