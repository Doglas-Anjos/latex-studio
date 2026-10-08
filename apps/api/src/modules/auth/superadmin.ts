import type { AppConfig } from '@latex-studio/core';
import { LOCAL_IDENTITY } from './application/identity.service';

type AdminConfig = Pick<AppConfig, 'SUPERADMIN_EMAILS'>;

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
 * is the local user, who governs the dev/self-hosted-localhost instance.
 */
export function isSuperadmin(email: string, config: AdminConfig): boolean {
  if (email.toLowerCase() === LOCAL_IDENTITY.email) return true;
  return adminEmails(config).has(email.toLowerCase());
}
