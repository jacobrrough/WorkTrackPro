/**
 * ⚠️  HELD / HIGH-RISK / UNVERIFIED — NOT FOR FILING. PHASE E SECURITY HARDENING — Backup & restore.
 *     The whole module is FLAG-DARK and requires a SECURITY review before it is enabled; this screen
 *     carries the UnverifiedBanner (via SecurityScreen).
 *
 * This is a DOCUMENTATION STUB. It performs NO destructive action — there is no button that dumps,
 * deletes, or restores anything. It reads the documented backup/restore POLICY (read-only, from
 * accounting.settings) and renders the operator runbook (pg_dump + AES-256-GCM at rest, supervised
 * manual restore). The restore procedure stays a deliberate, human-run operation off-app; validating
 * it end-to-end on a non-prod copy is on the human-verify list.
 */
import { Card } from '@/components/ui/Card';
import { useBackupPolicy } from '../hooks/useAccountingQueries';
import { backupPolicyRows } from '../securityView';
import { SecurityError, SecurityScreen } from './SecurityScreen';

/** A numbered runbook step block. */
function RunbookStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-white">{title}</p>
        <div className="mt-0.5 text-sm text-slate-400">{children}</div>
      </div>
    </li>
  );
}

/** A read-only command sample (not executable here — copy into a trusted operator shell). */
function CommandSample({ children }: { children: string }) {
  return (
    <pre className="mt-1 overflow-x-auto rounded-sm border border-white/10 bg-background-dark p-2 font-mono text-xs text-slate-300">
      {children}
    </pre>
  );
}

export default function BackupRestoreView() {
  const { data: policy, isPending, isError, refetch } = useBackupPolicy();

  return (
    <SecurityScreen
      tab="backup"
      title="Backup & restore"
      intro="The documented backup/restore policy and the operator runbook. This screen is read-only — it performs no backup, deletion, or restore. Those stay deliberate, supervised, off-app operations."
    >
      {/* Loud no-action notice (in addition to the UnverifiedBanner). */}
      <Card padding="lg" className="border border-amber-500/30 bg-amber-500/10">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-amber-300">info</span>
          <p className="text-sm text-amber-100">
            <span className="font-bold">No destructive actions.</span> This is a reference screen.
            There is intentionally no button to dump, delete, or restore the database. Run the
            commands below only from a trusted operator environment, never from the app.
          </p>
        </div>
      </Card>

      {/* Policy (read-only, from accounting.settings). */}
      <section>
        <h3 className="flex items-center gap-2 text-base font-bold text-white">
          <span className="material-symbols-outlined text-primary">policy</span>
          Backup policy
        </h3>

        {isPending && <p className="mt-3 text-sm text-slate-400">Loading the backup policy…</p>}

        {!isPending && isError && (
          <div className="mt-3">
            <SecurityError
              message="Could not load the backup policy. Confirm the accounting schema is exposed and you have an accounting role."
              onRetry={() => refetch()}
            />
          </div>
        )}

        {!isPending && !isError && policy && (
          <Card className="mt-3" padding="none">
            <div className="divide-y divide-white/5">
              {backupPolicyRows(policy).map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm text-slate-300">{r.label}</span>
                  <span className="font-mono text-sm text-white">{r.value}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>

      {/* Operator runbook (documentation). */}
      <section className="border-t border-white/10 pt-5">
        <h3 className="flex items-center gap-2 text-base font-bold text-white">
          <span className="material-symbols-outlined text-primary">menu_book</span>
          Operator runbook
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          A logical backup with pg_dump, encrypted at rest with AES-256-GCM, stored off-platform, and
          restored manually under supervision. Adjust to your Supabase plan and key custody.
        </p>

        <Card className="mt-3" padding="lg">
          <ol className="flex flex-col gap-4">
            <RunbookStep n={1} title="Dump the database (custom format)">
              From a trusted host with the connection string in the environment:
              <CommandSample>{`pg_dump "$DATABASE_URL" --format=custom --no-owner \\
  --file "wtp-$(date +%Y%m%d-%H%M%S).dump"`}</CommandSample>
            </RunbookStep>

            <RunbookStep n={2} title="Encrypt at rest (AES-256-GCM)">
              Encrypt the dump with a key held in your secrets manager (never in the repo or the app):
              <CommandSample>{`openssl enc -aes-256-gcm -pbkdf2 -salt \\
  -in wtp-*.dump -out wtp-*.dump.enc -pass env:BACKUP_KEY`}</CommandSample>
            </RunbookStep>

            <RunbookStep n={3} title="Store off-platform with retention">
              Upload the <span className="font-mono">.enc</span> artifact to versioned, access-controlled
              object storage. Enforce the documented retention ({policy?.retentionDays ?? '—'} days) and
              verify the upload checksum.
            </RunbookStep>

            <RunbookStep n={4} title="Restore — supervised, on a fresh target">
              Restore to a NEW database first and validate before any cutover:
              <CommandSample>{`openssl enc -d -aes-256-gcm -pbkdf2 \\
  -in wtp-*.dump.enc -out wtp-*.dump -pass env:BACKUP_KEY
pg_restore --no-owner --dbname "$RESTORE_TARGET_URL" wtp-*.dump`}</CommandSample>
            </RunbookStep>

            <RunbookStep n={5} title="Point-in-time recovery">
              For PITR, rely on your Supabase plan’s continuous backups ({policy?.pitrExpectation ?? '—'}).
              This dump runbook complements, not replaces, platform PITR.
            </RunbookStep>
          </ol>
        </Card>

        <div className="mt-3 rounded-sm border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <span className="font-bold">Human must verify:</span> validate this runbook end-to-end on a
          non-prod copy (dump → encrypt → store → decrypt → restore → integrity check), confirm key
          custody and rotation, and keep restore a supervised manual step. The encrypted field key
          (pgcrypto) and the backup key are <span className="font-semibold">separate</span> secrets —
          a backup is only as recoverable as the key that decrypts it.
        </div>
      </section>
    </SecurityScreen>
  );
}
