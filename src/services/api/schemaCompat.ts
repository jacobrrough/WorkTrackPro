export type SchemaErrorLike = {
  code?: string;
  message?: string | null;
};

type MutationResult<T> = {
  data: T | null;
  error: SchemaErrorLike | null;
};

type RunWithSchemaFallbackParams<T> = {
  initialPayload: Record<string, unknown>;
  tableName: string;
  mutate: (payload: Record<string, unknown>) => Promise<MutationResult<T>>;
};

type RunWithSchemaFallbackResult<T> = MutationResult<T> & {
  usedPayload: Record<string, unknown>;
  strippedColumns: string[];
};

export function getMissingColumnFromSchemaError(
  error: SchemaErrorLike | null | undefined,
  tableName: string
): string | null {
  const message = error?.message;
  if (!message) return null;

  const postgrestPattern = new RegExp(
    `Could not find the '([^']+)' column of '${tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' in the schema cache`,
    'i'
  );
  const postgrestMatch = message.match(postgrestPattern);
  if (postgrestMatch?.[1]) return postgrestMatch[1];

  // Postgres may report relation as "jobs" or "public.jobs"
  const postgresPattern = new RegExp(
    `column "([^"]+)" of relation "(?:public\\.)?${tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" does not exist`,
    'i'
  );
  const postgresMatch = message.match(postgresPattern);
  if (postgresMatch?.[1]) return postgresMatch[1];

  return null;
}

const knownMissingColumnsByTable = new Map<string, Set<string>>();
const STORAGE_KEY_PREFIX = 'supabase_schema_omit_';

/**
 * How long a column may stay on the persisted "known missing" list before it is
 * re-probed against the database. A short TTL means a transient PostgREST
 * stale-cache strip (the column exists, but the schema cache was momentarily
 * stale) self-heals on the next attempt instead of silently dropping that
 * column forever. A genuinely missing column is simply re-stripped (one extra
 * failed attempt) and re-stamped with a fresh timestamp, so steady-state
 * behavior is unchanged. This TTL also replaces the old hardcoded per-column
 * "heal" lists: any historically over-persisted strip clears itself once it
 * ages out.
 */
const KNOWN_MISSING_TTL_MS = 15 * 60 * 1000;

/** Persisted shape: column name -> epoch ms at which it was last stripped. */
type PersistedKnownMissing = Record<string, number>;

/**
 * Read the persisted timestamp map for a table, tolerating the historical
 * `string[]` format. Legacy array entries carry no timestamp, so they are
 * treated as already-expired (dropped) — this is what retires the old heal
 * lists: any column that was permanently cached as missing under the previous
 * no-TTL behavior is re-probed instead of silently stripped forever.
 */
function readPersistedKnownMissing(tableName: string): PersistedKnownMissing {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY_PREFIX + tableName);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      // Legacy format with no timestamps: drop so it re-probes (TTL self-heal).
      return {};
    }
    if (parsed && typeof parsed === 'object') {
      const out: PersistedKnownMissing = {};
      for (const [col, ts] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof ts === 'number' && Number.isFinite(ts)) out[col] = ts;
      }
      return out;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

/** Only for tests: clear cached missing columns so fallback retries from scratch */
export function clearSchemaCacheForTest(tableName: string): void {
  knownMissingColumnsByTable.delete(tableName);
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + tableName);
  } catch {
    /* ignore */
  }
}

function loadKnownMissing(tableName: string): Set<string> {
  let set = knownMissingColumnsByTable.get(tableName);
  if (set) return set;

  const persisted = readPersistedKnownMissing(tableName);
  const now = Date.now();
  set = new Set<string>();
  let prunedExpired = false;
  for (const [col, ts] of Object.entries(persisted)) {
    if (now - ts < KNOWN_MISSING_TTL_MS) {
      set.add(col);
    } else {
      // Stale entry past its TTL: drop it and let the next mutation re-probe.
      prunedExpired = true;
    }
  }
  // Rewrite storage if we dropped expired entries so they don't linger and we
  // don't re-prune on every load.
  if (prunedExpired) saveKnownMissing(tableName, set);

  knownMissingColumnsByTable.set(tableName, set);
  return set;
}

function saveKnownMissing(tableName: string, set: Set<string>): void {
  try {
    // Preserve existing timestamps for columns still present, stamp newly added
    // ones with the current time, and drop any column no longer in the set.
    const existing = readPersistedKnownMissing(tableName);
    const now = Date.now();
    const next: PersistedKnownMissing = {};
    for (const col of set) {
      next[col] = typeof existing[col] === 'number' ? existing[col] : now;
    }
    localStorage.setItem(STORAGE_KEY_PREFIX + tableName, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export async function runMutationWithSchemaFallback<T>({
  initialPayload,
  tableName,
  mutate,
}: RunWithSchemaFallbackParams<T>): Promise<RunWithSchemaFallbackResult<T>> {
  const knownMissing = loadKnownMissing(tableName);
  const strippedColumns: string[] = [];

  let candidatePayload: Record<string, unknown> = { ...initialPayload };
  for (const key of knownMissing) {
    if (key in candidatePayload) {
      delete candidatePayload[key];
      strippedColumns.push(key);
    }
  }

  const attemptedMissingColumns = new Set<string>();
  const maxIterations = Math.max(1, Object.keys(candidatePayload).length + 1);
  let didStripThisRun = false;

  for (let i = 0; i < maxIterations; i += 1) {
    const result = await mutate(candidatePayload);
    if (!result.error) {
      if (didStripThisRun && strippedColumns.length > 0) {
        const hint =
          tableName === 'jobs' &&
          strippedColumns.some((c) => c === 'cnc_completed_at' || c === 'cnc_completed_by')
            ? "Run migration 20260302000001_add_job_cnc_completion.sql, then NOTIFY pgrst, 'reload schema'; and clear localStorage key supabase_schema_omit_jobs to stop omitting them."
            : `Run the migration that adds these columns, then NOTIFY pgrst, 'reload schema';`;
        console.warn(
          `Schema fallback: omitted columns not in database (${hint}): ${[...new Set(strippedColumns)].join(', ')}`
        );
      }
      return { ...result, usedPayload: candidatePayload, strippedColumns };
    }

    const missingColumn = getMissingColumnFromSchemaError(result.error, tableName);
    if (!missingColumn || !(missingColumn in candidatePayload)) {
      return { ...result, usedPayload: candidatePayload, strippedColumns };
    }

    if (attemptedMissingColumns.has(missingColumn)) {
      return { ...result, usedPayload: candidatePayload, strippedColumns };
    }

    didStripThisRun = true;
    attemptedMissingColumns.add(missingColumn);
    knownMissing.add(missingColumn);
    saveKnownMissing(tableName, knownMissing);
    strippedColumns.push(missingColumn);
    const nextPayload = { ...candidatePayload };
    delete nextPayload[missingColumn];
    candidatePayload = nextPayload;
  }

  const result = await mutate(candidatePayload);
  if (didStripThisRun && strippedColumns.length > 0 && !result.error) {
    console.warn(
      `Schema fallback: omitted columns not in database (run migration 20260224000007 if you need them): ${[...new Set(strippedColumns)].join(', ')}`
    );
  }
  return { ...result, usedPayload: candidatePayload, strippedColumns };
}
