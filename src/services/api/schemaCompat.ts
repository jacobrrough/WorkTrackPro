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

/** Run once on module load to fix jobs cache so part_id is no longer stripped (job–part linking and BOM/labor work again). */
function healJobsPartIdCache(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + 'jobs');
    if (!raw) return;
    const arr = JSON.parse(raw) as string[];
    const set = new Set(Array.isArray(arr) ? arr : []);
    if (!set.has('part_id')) return;
    set.delete('part_id');
    localStorage.setItem(STORAGE_KEY_PREFIX + 'jobs', JSON.stringify([...set]));
    knownMissingColumnsByTable.delete('jobs');
  } catch {
    /* ignore */
  }
}
healJobsPartIdCache();

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
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + tableName);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    set = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    set = new Set();
  }
  // Self-heal: part_id must not be stripped for jobs (migration 20250217000001 adds it).
  // If it was previously cached as missing, stop stripping it so job–part linking and BOM/labor work again.
  if (tableName === 'jobs' && set.has('part_id')) {
    set.delete('part_id');
    saveKnownMissing(tableName, set);
  }
  knownMissingColumnsByTable.set(tableName, set);
  return set;
}

function saveKnownMissing(tableName: string, set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + tableName, JSON.stringify([...set]));
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
        console.warn(
          `Schema fallback: omitted columns not in database (run migration 20260224000007 if you need them): ${[...new Set(strippedColumns)].join(', ')}`
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
