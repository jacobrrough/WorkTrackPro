import { describe, expect, it } from 'vitest';
import {
  clearSchemaCacheForTest,
  getMissingColumnFromSchemaError,
  runMutationWithSchemaFallback,
} from './schemaCompat';

describe('getMissingColumnFromSchemaError', () => {
  it('parses PostgREST schema cache missing-column errors', () => {
    const missing = getMissingColumnFromSchemaError(
      {
        message: "Could not find the 'allocation_source' column of 'jobs' in the schema cache",
      },
      'jobs'
    );
    expect(missing).toBe('allocation_source');
  });

  it('parses Postgres missing-column relation errors', () => {
    const missing = getMissingColumnFromSchemaError(
      {
        message: 'column "allocation_source" of relation "jobs" does not exist',
      },
      'jobs'
    );
    expect(missing).toBe('allocation_source');
  });

  it('parses Postgres relation with schema (public.jobs)', () => {
    const missing = getMissingColumnFromSchemaError(
      {
        message: 'column "labor_breakdown_by_variant" of relation "public.jobs" does not exist',
      },
      'jobs'
    );
    expect(missing).toBe('labor_breakdown_by_variant');
  });

  it('returns null for unrelated errors', () => {
    const missing = getMissingColumnFromSchemaError(
      {
        message: 'new row violates row-level security policy for table "jobs"',
      },
      'jobs'
    );
    expect(missing).toBeNull();
  });
});

describe('runMutationWithSchemaFallback', () => {
  it('strips missing columns and retries until success', async () => {
    clearSchemaCacheForTest('jobs');
    const payload = {
      name: 'Example',
      allocation_source: 'variant',
      allocation_source_updated_at: '2026-01-01T00:00:00.000Z',
    };

    const seenPayloads: Record<string, unknown>[] = [];
    const result = await runMutationWithSchemaFallback({
      tableName: 'jobs',
      initialPayload: payload,
      mutate: async (candidate) => {
        seenPayloads.push(candidate);
        if ('allocation_source' in candidate) {
          return {
            data: null,
            error: {
              message:
                "Could not find the 'allocation_source' column of 'jobs' in the schema cache",
            },
          };
        }
        if ('allocation_source_updated_at' in candidate) {
          return {
            data: null,
            error: {
              message:
                "Could not find the 'allocation_source_updated_at' column of 'jobs' in the schema cache",
            },
          };
        }
        return { data: { id: 'job-1' }, error: null };
      },
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: 'job-1' });
    expect(result.strippedColumns).toEqual(['allocation_source', 'allocation_source_updated_at']);
    expect(seenPayloads).toHaveLength(3);
  });

  it('does not retry for non-schema errors', async () => {
    let attempts = 0;
    const result = await runMutationWithSchemaFallback({
      tableName: 'jobs',
      initialPayload: { name: 'Example' },
      mutate: async () => {
        attempts += 1;
        return {
          data: null,
          error: { message: 'permission denied for table jobs' },
        };
      },
    });

    expect(attempts).toBe(1);
    expect(result.error?.message).toContain('permission denied');
    expect(result.strippedColumns).toEqual([]);
  });
});

describe('runMutationWithSchemaFallback — persisted TTL self-heal', () => {
  const STORAGE_KEY = 'supabase_schema_omit_jobs';
  const TTL_MS = 15 * 60 * 1000;

  it('re-probes (does not pre-strip) a persisted column once it is past its TTL', async () => {
    // Simulate a transient stale-cache strip that was persisted long ago.
    const expiredTs = Date.now() - (TTL_MS + 60_000);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ allocation_source: expiredTs }));
    clearSchemaCacheForTest('jobs'); // forces a reload from storage; but keep storage…
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ allocation_source: expiredTs }));

    const seenPayloads: Record<string, unknown>[] = [];
    const result = await runMutationWithSchemaFallback({
      tableName: 'jobs',
      initialPayload: { name: 'Example', allocation_source: 'variant' },
      // Column now exists in the DB: every payload succeeds.
      mutate: async (candidate) => {
        seenPayloads.push(candidate);
        return { data: { id: 'job-1' }, error: null };
      },
    });

    // The expired entry must NOT have been stripped up-front — the value is kept.
    expect(result.strippedColumns).toEqual([]);
    expect(result.usedPayload).toHaveProperty('allocation_source', 'variant');
    expect(seenPayloads).toHaveLength(1);
    // Expired entry should have been pruned from storage.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({});

    clearSchemaCacheForTest('jobs');
  });

  it('still pre-strips a persisted column that is within its TTL (no premature heal)', async () => {
    const freshTs = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ allocation_source: freshTs }));
    clearSchemaCacheForTest('jobs');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ allocation_source: freshTs }));

    const seenPayloads: Record<string, unknown>[] = [];
    const result = await runMutationWithSchemaFallback({
      tableName: 'jobs',
      initialPayload: { name: 'Example', allocation_source: 'variant' },
      mutate: async (candidate) => {
        seenPayloads.push(candidate);
        return { data: { id: 'job-1' }, error: null };
      },
    });

    // Fresh entry is stripped up-front without an extra probe.
    expect(result.strippedColumns).toEqual(['allocation_source']);
    expect(result.usedPayload).not.toHaveProperty('allocation_source');
    expect(seenPayloads).toHaveLength(1);

    clearSchemaCacheForTest('jobs');
  });

  it('treats the legacy string[] persisted format as expired and re-probes', async () => {
    // Old no-TTL format: a bare array with no timestamps.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['allocation_source']));
    clearSchemaCacheForTest('jobs');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['allocation_source']));

    const seenPayloads: Record<string, unknown>[] = [];
    const result = await runMutationWithSchemaFallback({
      tableName: 'jobs',
      initialPayload: { name: 'Example', allocation_source: 'variant' },
      mutate: async (candidate) => {
        seenPayloads.push(candidate);
        return { data: { id: 'job-1' }, error: null };
      },
    });

    // Legacy entry is not trusted: the column is kept and re-probed (succeeds).
    expect(result.strippedColumns).toEqual([]);
    expect(result.usedPayload).toHaveProperty('allocation_source', 'variant');
    expect(seenPayloads).toHaveLength(1);

    clearSchemaCacheForTest('jobs');
  });

  it('stamps a newly stripped column and persists it as a timestamp map', async () => {
    clearSchemaCacheForTest('jobs');
    const before = Date.now();

    await runMutationWithSchemaFallback({
      tableName: 'jobs',
      initialPayload: { name: 'Example', allocation_source: 'variant' },
      mutate: async (candidate) => {
        if ('allocation_source' in candidate) {
          return {
            data: null,
            error: {
              message:
                "Could not find the 'allocation_source' column of 'jobs' in the schema cache",
            },
          };
        }
        return { data: { id: 'job-1' }, error: null };
      },
    });

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      number
    >;
    expect(Object.keys(persisted)).toEqual(['allocation_source']);
    expect(persisted.allocation_source).toBeGreaterThanOrEqual(before);
    expect(persisted.allocation_source).toBeLessThanOrEqual(Date.now());

    clearSchemaCacheForTest('jobs');
  });
});
