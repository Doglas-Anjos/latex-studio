/** Public view of a user: safe to return from the API. */
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  /** Which authenticator vouched for them: 'local', 'lan' (a PIN guest), or the SSO issuer URL. */
  issuer: string;
}

/** What the authenticator in front vouches for. */
export interface Identity {
  issuer: string;
  subject: string;
  email: string;
  name: string;
}
