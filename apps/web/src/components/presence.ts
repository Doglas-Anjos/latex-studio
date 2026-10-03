const FALLBACK = [
  '#b3321f',
  '#1f6fa8',
  '#3f7a3a',
  '#8a5a00',
  '#7a3f8f',
  '#0f7a7a',
  '#a8456f',
  '#5a5f6a',
];

/** Stable palette slot (djb2 hash of the id), 0..7. */
export function peerSlot(id: string): number {
  let h = 5381;
  for (const ch of id) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}

export function peerColor(id: string): string {
  const n = peerSlot(id);
  const css = getComputedStyle(document.documentElement)
    .getPropertyValue(`--peer-${n + 1}`)
    .trim();
  return css || (FALLBACK[n] as string);
}
