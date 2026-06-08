import type { PortalToken, PortalTokenScope } from '../../../features/accounting/types';
import { acct } from './accountingClient';
import type { Row } from './mappers';

/**
 * #7 — customer portal access tokens (accounting.portal_tokens).
 *
 * A portal link is an OPAQUE high-entropy token; the DB stores ONLY its SHA-256 hash
 * (column token_hash) so a table leak yields no usable links. This service runs on the
 * AUTHED accounting client (RLS: can_write to mint/revoke, can_read to list).
 *
 * `createLink` generates the raw token + hash IN THE BROWSER (Web Crypto), inserts the row
 * with the hash, and returns the RAW token to the caller exactly once so the UI can show the
 * /portal/<token> link. The raw token is never persisted.
 *
 * Reads throw (React Query surfaces them); mutations return a result object so the UI can
 * surface a DB error (e.g. insufficient_privilege) inline.
 */

const nstr = (v: unknown): string | null => (v == null ? null : String(v));

/** Map an accounting.portal_tokens row (NB: token_hash is intentionally NOT mapped out). */
export function mapPortalTokenRow(row: Row): PortalToken {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    scope: (row.scope as PortalTokenScope) ?? 'invoice',
    invoiceId: nstr(row.invoice_id),
    expiresAt: nstr(row.expires_at),
    revokedAt: nstr(row.revoked_at),
    lastUsedAt: nstr(row.last_used_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Generate a 32-byte base64url opaque token (URL-safe, ~43 chars). */
function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 (hex) of a raw token — matches the server's node:crypto hashing exactly. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Build the public portal URL for a raw token (site origin + /portal/<token>). */
export function portalLinkFor(rawToken: string): string {
  return `${window.location.origin}/portal/${rawToken}`;
}

export interface CreatePortalLinkParams {
  /** The owning customer (required for both scopes). */
  customerId: string;
  scope: PortalTokenScope;
  /** Required when scope === 'invoice'; ignored for 'customer'. */
  invoiceId?: string | null;
  /** ISO timestamp the link expires at, or null for no expiry. */
  expiresAt?: string | null;
}

export const portalTokensService = {
  /**
   * Mint a portal link. Generates the raw token + hash in the browser, stores the hash, and
   * returns the RAW token + the full link. The raw token is shown once and never persisted.
   */
  async createLink(
    params: CreatePortalLinkParams
  ): Promise<{ token?: string; link?: string; tokenId?: string; error?: string }> {
    if (params.scope === 'invoice' && !params.invoiceId) {
      return { error: 'An invoice-scoped link needs an invoice.' };
    }
    const rawToken = generateRawToken();
    const tokenHash = await sha256Hex(rawToken);

    const { data, error } = await acct()
      .from('portal_tokens')
      .insert({
        token_hash: tokenHash,
        customer_id: params.customerId,
        scope: params.scope,
        invoice_id: params.scope === 'invoice' ? (params.invoiceId ?? null) : null,
        expires_at: params.expiresAt ?? null,
      })
      .select('id')
      .single();
    if (error || !data) return { error: error?.message ?? 'Could not create the portal link.' };

    return { token: rawToken, link: portalLinkFor(rawToken), tokenId: String((data as Row).id) };
  },

  /** Revoke a portal link (sets revoked_at; the payload RPC then returns nothing for it). */
  async revoke(tokenId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await acct()
      .from('portal_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Tokens minted for a given invoice, newest first (token_hash never returned). */
  async listForInvoice(invoiceId: string): Promise<PortalToken[]> {
    const { data, error } = await acct()
      .from('portal_tokens')
      .select(
        'id, customer_id, scope, invoice_id, expires_at, revoked_at, last_used_at, created_at, updated_at'
      )
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapPortalTokenRow);
  },
};
