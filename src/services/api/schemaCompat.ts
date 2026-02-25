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
    `Could not find the '([^']+)' column of '${tableName}' in the schema cache`,
    'i'
  );
  const postgrestMatch = message.match(postgrestPattern);
  if (postgrestMatch?.[1]) return postgrestMatch[1];

  const postgresPattern = new RegExp(
    `column "([^"]+)" of relation "${tableName}" does not exist`,
    'i'
  );
  const postgresMatch = message.match(postgresPattern);
  if (postgresMatch?.[1]) return postgresMatch[1];

  return null;
}

export async function runMutationWithSchemaFallback<T>({
  initialPayload,
  tableName,
  mutate,
}: RunWithSchemaFallbackParams<T>): Promise<RunWithSchemaFallbackResult<T>> {
  let candidatePayload: Record<string, unknown> = { ...initialPayload };
  const strippedColumns: string[] = [];
  const attemptedMissingColumns = new Set<string>();
  const maxIterations = Math.max(1, Object.keys(initialPayload).length + 1);

  for (let i = 0; i < maxIterations; i += 1) {
    const result = await mutate(candidatePayload);
    if (!result.error) {
      return { ...result, usedPayload: candidatePayload, strippedColumns };
    }

    const missingColumn = getMissingColumnFromSchemaError(result.error, tableName);
    if (!missingColumn || !(missingColumn in candidatePayload)) {
      return { ...result, usedPayload: candidatePayload, strippedColumns };
    }

    if (attemptedMissingColumns.has(missingColumn)) {
      return { ...result, usedPayload: candidatePayload, strippedColumns };
    }

    attemptedMissingColumns.add(missingColumn);
    strippedColumns.push(missingColumn);
    const nextPayload = { ...candidatePayload };
    delete nextPayload[missingColumn];
    candidatePayload = nextPayload;
  }

  const result = await mutate(candidatePayload);
  return { ...result, usedPayload: candidatePayload, strippedColumns };
}
