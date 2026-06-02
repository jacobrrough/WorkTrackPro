/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. PHASE E SECURITY HARDENING — RBAC management.
 *     The whole module is FLAG-DARK and requires a SECURITY review before it is enabled; this screen
 *     carries the UnverifiedBanner (via SecurityScreen). Granting/revoking a role moves NO money and
 *     posts NO journal entry.
 *
 * CRUD over accounting.user_roles: one row per user with the set of accounting roles they hold, an
 * "add a role" picker (approved profiles × the not-yet-held roles), and a per-role revoke. The DB is
 * the SOLE authorization authority — the RLS "manage" policy restricts insert/delete to
 * accounting_admin. The whole accounting module is ALSO behind AdminGuard (route level). A non-admin
 * write is rejected by RLS and surfaced inline as { ok:false, error } — this screen never decides
 * authorization client-side.
 *
 * Role legend (informational): admin can manage roles + post/void + lock; accountant reads/writes
 * postings; payroll accesses payroll + the encrypted SSN/bank/wage fields; viewer is read-only.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { useRoleCandidates, useUserRoles } from '../hooks/useAccountingQueries';
import { useGrantRole, useRevokeRole } from '../hooks/useAccountingMutations';
import {
  grantableRoles,
  orderedRoleLabels,
  rbacSummary,
  roleLabel,
  toneBadgeClass,
  userDisplayLabel,
  userSecondaryLabel,
} from '../securityView';
import {
  ACCOUNTING_ROLE_DESCRIPTIONS,
  ACCOUNTING_ROLE_KEYS,
  type AccountingRoleKey,
  type RoleCandidate,
  type UserRoleSummary,
} from '../types';
import { SecurityError, SecurityScreen } from './SecurityScreen';

const selectClass =
  'w-full rounded-sm border border-white/10 bg-background-dark px-2 py-1.5 text-white focus:border-primary focus:outline-none';

/** The informational role legend so an admin understands what each grant confers. */
function RoleLegend() {
  return (
    <Card padding="lg" className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-400">
        <span className="material-symbols-outlined text-base text-primary">help</span>
        What each role can do
      </h3>
      <ul className="flex flex-col gap-1.5">
        {ACCOUNTING_ROLE_KEYS.map((key) => (
          <li key={key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <span className="shrink-0 font-semibold text-white sm:w-36">{roleLabel(key)}</span>
            <span className="text-sm text-slate-400">{ACCOUNTING_ROLE_DESCRIPTIONS[key]}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One per-user row: identity, the held-role chips (each revocable), and the held set. */
function UserRoleRow({ summary }: { summary: UserRoleSummary }) {
  const revoke = useRevokeRole();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AccountingRoleKey | null>(null);

  const onRevoke = async (role: AccountingRoleKey) => {
    setError(null);
    setPending(role);
    const res = await revoke.mutateAsync({ userId: summary.userId, role });
    setPending(null);
    if (!res.ok) {
      setError(
        res.error ?? 'Could not revoke this role. Confirm you hold the accounting_admin role.'
      );
    }
  };

  const labels = orderedRoleLabels(summary.roles);

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-white">{userDisplayLabel(summary)}</p>
          <p className="truncate text-xs text-slate-500">{userSecondaryLabel(summary)}</p>
        </div>
        <span className="shrink-0 text-[11px] text-slate-500">
          {summary.roles.length} role{summary.roles.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {labels.length === 0 && <span className="text-xs text-slate-500">No roles.</span>}
        {/* Render chips in privilege order; map each label back to its key for the revoke. */}
        {ACCOUNTING_ROLE_KEYS.filter((k) => summary.roles.includes(k)).map((key) => (
          <span
            key={key}
            className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${toneBadgeClass('good')}`}
          >
            {roleLabel(key)}
            <button
              type="button"
              aria-label={`Revoke ${roleLabel(key)} from ${userDisplayLabel(summary)}`}
              onClick={() => onRevoke(key)}
              disabled={pending === key}
              className="flex items-center text-green-300/80 hover:text-white disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </span>
        ))}
      </div>

      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The "grant a role" card: pick an approved user + a role, then grant (idempotent at the service). */
function GrantCard({
  candidates,
  summaries,
}: {
  candidates: RoleCandidate[];
  summaries: UserRoleSummary[];
}) {
  const grant = useGrantRole();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<AccountingRoleKey | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // The roles the selected user does NOT already hold (so we don't offer a redundant grant).
  const heldByUser = useMemo(() => {
    const map = new Map<string, AccountingRoleKey[]>();
    for (const s of summaries) map.set(s.userId, s.roles);
    return map;
  }, [summaries]);

  const offerableRoles = userId
    ? grantableRoles(heldByUser.get(userId) ?? [])
    : ACCOUNTING_ROLE_KEYS;

  const onGrant = async () => {
    setError(null);
    setOkMsg(null);
    if (!userId) {
      setError('Pick a user.');
      return;
    }
    if (!role) {
      setError('Pick a role.');
      return;
    }
    const res = await grant.mutateAsync({ userId, role });
    if (!res.ok) {
      setError(
        res.error ?? 'Could not grant this role. Confirm you hold the accounting_admin role.'
      );
      return;
    }
    const candidate = candidates.find((c) => c.userId === userId);
    setOkMsg(`Granted ${roleLabel(role)} to ${candidate?.name || candidate?.email || 'the user'}.`);
    setRole('');
  };

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-base font-bold text-white">
        <span className="material-symbols-outlined text-primary">person_add</span>
        Grant a role
      </h3>

      {candidates.length === 0 ? (
        <p className="text-sm text-slate-400">
          No approved users are available to grant a role to.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="User" htmlFor="rbac-user">
              <select
                id="rbac-user"
                className={selectClass}
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setRole('');
                  setError(null);
                  setOkMsg(null);
                }}
              >
                <option value="">Select a user…</option>
                {candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name || c.email || c.userId}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              label="Role"
              htmlFor="rbac-role"
              hint={
                userId && offerableRoles.length === 0
                  ? 'This user already holds every role.'
                  : undefined
              }
            >
              <select
                id="rbac-role"
                className={selectClass}
                value={role}
                disabled={!userId || offerableRoles.length === 0}
                onChange={(e) => {
                  setRole(e.target.value as AccountingRoleKey);
                  setError(null);
                  setOkMsg(null);
                }}
              >
                <option value="">Select a role…</option>
                {offerableRoles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {role && <p className="text-xs text-slate-500">{ACCOUNTING_ROLE_DESCRIPTIONS[role]}</p>}

          <div className="flex items-center justify-end gap-3">
            {error && (
              <span className="mr-auto text-sm text-red-400" role="alert">
                {error}
              </span>
            )}
            {!error && okMsg && <span className="mr-auto text-sm text-green-400">{okMsg}</span>}
            <Button
              size="sm"
              icon="add"
              onClick={onGrant}
              disabled={grant.isPending || !userId || !role}
            >
              {grant.isPending ? 'Granting…' : 'Grant role'}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export default function RbacManagementView() {
  const rolesQuery = useUserRoles();
  const candidatesQuery = useRoleCandidates();

  const isPending = rolesQuery.isPending || candidatesQuery.isPending;
  const isError = rolesQuery.isError || candidatesQuery.isError;

  const summaries = rolesQuery.data ?? [];
  const candidates = candidatesQuery.data ?? [];

  return (
    <SecurityScreen
      tab="roles"
      title="Role management"
      intro="Grant or revoke accounting roles. Restricted to the accounting_admin role at the database — a non-admin's change is rejected. Changes are recorded in the accounting audit log."
    >
      <RoleLegend />

      {isPending && <p className="text-sm text-slate-400">Loading role grants…</p>}

      {!isPending && isError && (
        <SecurityError
          message="Could not load the role grants. Confirm the accounting schema is exposed and you have an accounting role."
          onRetry={() => {
            rolesQuery.refetch();
            candidatesQuery.refetch();
          }}
        />
      )}

      {!isPending && !isError && (
        <>
          <GrantCard candidates={candidates} summaries={summaries} />

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Current grants
              </h3>
              <span className="text-[11px] text-slate-500">{rbacSummary(summaries)}</span>
            </div>

            {summaries.length === 0 ? (
              <Card padding="lg">
                <p className="text-sm text-slate-400">
                  No accounting roles are granted yet. Use “Grant a role” above to assign the first
                  one.
                </p>
              </Card>
            ) : (
              <Card padding="none">
                <div className="divide-y divide-white/5">
                  {summaries.map((s) => (
                    <UserRoleRow key={s.userId} summary={s} />
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </SecurityScreen>
  );
}
