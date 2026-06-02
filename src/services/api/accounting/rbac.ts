/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. PHASE E RBAC management seam.
 *     The whole module is FLAG-DARK (VITE_ACCOUNTING_ENABLED off) and requires a SECURITY review
 *     before it is enabled. The RBAC management screen renders the UnverifiedBanner (UI lane).
 *
 * CRUD over accounting.user_roles (migration 001): grant / revoke an accounting role for a user.
 * The DB is the SOLE authorization authority — accounting.user_roles has an RLS policy
 * "acct user_roles manage" = FOR ALL USING accounting.has_role('accounting_admin'), so ONLY an
 * accounting_admin (or a global approved admin, who implicitly holds the role) may insert/delete a
 * grant. A non-admin's write is rejected by RLS and surfaces as { ok:false, error } — this service
 * never decides authorization client-side (defense in depth: the UI also gates the screen, but the
 * DB policy is the real guard).
 *
 * DOUBLE-ENTRY (G3): granting/revoking a role moves NO money and posts NO journal entry — vacuous.
 *
 * ISOLATION: the grant rows live in accounting.user_roles (read/written via acct()). The candidate
 * picker + the per-grant user hydration read public.profiles READ-ONLY via the base supabase client
 * (the same cross-schema pattern notificationDispatch.ts uses) — no public.* table is ever written.
 *
 * Convention: reads THROW (React Query surfaces them); grant/revoke RETURN a result object carrying
 * the DB error string (e.g. the RLS privilege error, or a unique-violation when re-granting an
 * existing role), so an expected DB rejection is shown inline and never thrown.
 */
import type {
  AccountingRoleKey,
  RoleCandidate,
  UserRoleGrant,
  UserRoleSummary,
} from '../../../features/accounting/types';
import { supabase } from '../supabaseClient';
import { acct } from './accountingClient';
import { mapRoleCandidateRow, mapUserRoleGrantRow, type Row } from './mappers';

/** The outcome of a grant/revoke write. Never throws on an expected DB rejection. */
export interface RbacWriteResult {
  ok: boolean;
  error?: string;
}

export const rbacService = {
  /**
   * All role grants (flat), hydrated with each user's email/name. We read the grants from
   * accounting.user_roles (RLS: can_read lets any role-holder see them) and hydrate the user
   * display fields from public.profiles in ONE batched read (cross-schema embeds aren't reliable
   * via PostgREST, so we join in JS — the same split-read pattern notificationDispatch uses).
   * Reads throw so React Query surfaces a failure.
   */
  async listGrants(): Promise<UserRoleGrant[]> {
    const { data, error } = await acct()
      .from('user_roles')
      .select('id, user_id, role, granted_by, granted_at')
      .order('granted_at', { ascending: false });
    if (error) throw error;
    const grants = ((data ?? []) as Row[]).map(mapUserRoleGrantRow);

    // Batch-hydrate the user display fields (email/name) from public.profiles.
    const userIds = Array.from(new Set(grants.map((g) => g.userId))).filter(Boolean);
    if (userIds.length > 0) {
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, email, name')
        .in('id', userIds);
      if (profErr) throw profErr;
      const byId = new Map<string, { email: string | null; name: string | null }>();
      for (const p of (profiles ?? []) as Array<{
        id?: unknown;
        email?: unknown;
        name?: unknown;
      }>) {
        if (p.id) {
          byId.set(String(p.id), {
            email: p.email == null ? null : String(p.email),
            name: p.name == null ? null : String(p.name),
          });
        }
      }
      for (const g of grants) {
        const prof = byId.get(g.userId);
        if (prof) {
          g.userEmail = prof.email;
          g.userName = prof.name;
        }
      }
    }
    return grants;
  },

  /**
   * The grants collapsed PER USER (the management screen's primary list): one row per user with the
   * set of roles they hold + the underlying grant rows (so a revoke can target the exact grant id).
   * Sorted by the user's display label for a stable list.
   */
  async listUserRoles(): Promise<UserRoleSummary[]> {
    const grants = await this.listGrants();
    const byUser = new Map<string, UserRoleSummary>();
    for (const g of grants) {
      let summary = byUser.get(g.userId);
      if (!summary) {
        summary = {
          userId: g.userId,
          userEmail: g.userEmail ?? null,
          userName: g.userName ?? null,
          roles: [],
          grants: [],
        };
        byUser.set(g.userId, summary);
      }
      if (!summary.roles.includes(g.role)) summary.roles.push(g.role);
      summary.grants.push(g);
    }
    const out = Array.from(byUser.values());
    const label = (s: UserRoleSummary) => (s.userName || s.userEmail || s.userId).toLowerCase();
    out.sort((a, b) => label(a).localeCompare(label(b)));
    return out;
  },

  /** The role keys a single user holds (active grants). Reads throw. */
  async rolesForUser(userId: string): Promise<AccountingRoleKey[]> {
    const { data, error } = await acct().from('user_roles').select('role').eq('user_id', userId);
    if (error) throw error;
    const roles = new Set<AccountingRoleKey>();
    for (const r of ((data ?? []) as Row[]).map(mapUserRoleGrantRow)) roles.add(r.role);
    return Array.from(roles);
  },

  /**
   * Candidate users the admin can grant a role to — approved users from public.profiles, READ-ONLY.
   * (Granting to a non-approved user is harmless — the helpers require approval to act — but we
   * surface approved users so the picker matches who can actually use a role.) Reads throw.
   */
  async listCandidates(): Promise<RoleCandidate[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name')
      .eq('is_approved', true)
      .order('name', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapRoleCandidateRow);
  },

  /**
   * GRANT a role to a user — INSERT into accounting.user_roles. The RLS "manage" policy gates this
   * to accounting_admin; a non-admin gets the privilege error back as { ok:false, error }. The table's
   * UNIQUE (user_id, role) makes a re-grant a no-op-style unique violation, which we treat as success
   * (the user already holds the role) so the UI is idempotent. `granted_by` is stamped with the
   * current user when available (best-effort; the column is nullable).
   */
  async grant(userId: string, role: AccountingRoleKey): Promise<RbacWriteResult> {
    if (!userId) return { ok: false, error: 'A user is required.' };
    let grantedBy: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      grantedBy = data.user?.id ?? null;
    } catch {
      grantedBy = null;
    }
    const { error } = await acct()
      .from('user_roles')
      .insert({ user_id: userId, role, granted_by: grantedBy });
    if (error) {
      // 23505 = unique_violation → the user already holds this role; treat as success (idempotent).
      if (error.code === '23505') return { ok: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  /**
   * REVOKE a role from a user — DELETE the matching accounting.user_roles row(s). RLS gates this to
   * accounting_admin. Deleting a grant that does not exist is a no-op (still ok). Returns { ok, error }.
   */
  async revoke(userId: string, role: AccountingRoleKey): Promise<RbacWriteResult> {
    const { error } = await acct()
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role', role);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  /** Revoke a single grant by its row id (when the UI holds the exact grant). RLS-gated to admin. */
  async revokeGrant(grantId: string): Promise<RbacWriteResult> {
    const { error } = await acct().from('user_roles').delete().eq('id', grantId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};
