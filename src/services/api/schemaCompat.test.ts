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
