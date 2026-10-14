import type { AppConfig } from '@latex-studio/core';
import { LOCAL_IDENTITY } from './application/identity.service';

type AdminConfig = Pick<AppConfig, 'SUPERADMIN_EMAILS' | 'AUTH_JWKS_URL' | 'AUTH_SECRET'>;

/** The configured admin e-mails, lowercased. */
function adminEmails(config: AdminConfig): Set<string> {
  return new Set(
    (config.SUPERADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * A platform superadmin governs every project and user. Designated by the operator through
 * SUPERADMIN_EMAILS (never by a claim the front app could forge). In local mode the only identity
 * is the local user, who governs the dev/self-hosted-localhost instance. With a verifier, its
 * e-mail is just a claim any token could carry, so it means nothing.
 */
export function isSuperadmin(email: string, config: AdminConfig): boolean {
  const localMode = !config.AUTH_JWKS_URL && !config.AUTH_SECRET;
  if (localMode && email.toLowerCase() === LOCAL_IDENTITY.email) return true;
  return adminEmails(config).has(email.toLowerCase());
}
