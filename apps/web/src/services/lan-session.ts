// A LAN guest's session token (minted by the backend after a PIN join). Kept in sessionStorage, not
// memory, so a reload on the guest's machine does not drop them back to the PIN screen. It is a
// short-lived JWT for one project, never the owner's credentials.
const KEY = 'lan:token';

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const lanSession = {
  get: read,
  active: () => read() !== null,
  set(token: string) {
    try {
      sessionStorage.setItem(KEY, token);
    } catch {}
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  },
};
