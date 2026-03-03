import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizePartNumber(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function loadLocalEnvFallback() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(scriptDir, '..', '.env.local');
  if (!existsSync(envPath)) return new Map();
  const out = new Map();
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    out.set(key, value);
  }
  return out;
}

async function main() {
  const localEnv = loadLocalEnvFallback();
  const url = readEnv('VITE_SUPABASE_URL') || localEnv.get('VITE_SUPABASE_URL') || '';
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY') || localEnv.get('VITE_SUPABASE_ANON_KEY') || '';
  const key = serviceRoleKey || anonKey;

  if (!url || !key) {
    console.error(
      [
        'Missing Supabase credentials.',
        'Required: VITE_SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY.',
      ].join(' ')
    );
    process.exitCode = 1;
    return;
  }

  const usingServiceRole = Boolean(serviceRoleKey);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: partsRows, error: partsError } = await supabase
    .from('parts')
    .select('id, part_number, created_at, updated_at')
    .order('part_number', { ascending: true });

  if (partsError) {
    console.error('Failed to read parts:', partsError.message);
    process.exitCode = 1;
    return;
  }

  const groups = new Map();
  for (const row of partsRows ?? []) {
    const canonical = normalizePartNumber(row.part_number);
    if (!canonical) continue;
    const list = groups.get(canonical) ?? [];
    list.push(row);
    groups.set(canonical, list);
  }

  const duplicateGroups = [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));

  console.log(
    `Duplicate part-number diagnostic (${usingServiceRole ? 'service-role' : 'anon'} credentials)`
  );
  console.log(`Parts scanned: ${(partsRows ?? []).length}`);
  console.log(`Duplicate canonical part numbers: ${duplicateGroups.length}`);

  if (duplicateGroups.length === 0) {
    console.log('No duplicate part numbers found.');
    return;
  }

  const duplicateCanonicalNumbers = new Set(duplicateGroups.map(([canonical]) => canonical));

  const { data: jobsRows, error: jobsError } = await supabase
    .from('jobs')
    .select('id, job_code, part_number, part_id, updated_at')
    .not('part_number', 'is', null);

  if (jobsError) {
    console.error('Failed to read jobs:', jobsError.message);
    process.exitCode = 1;
    return;
  }

  const affectedJobs = (jobsRows ?? []).filter((job) =>
    duplicateCanonicalNumbers.has(normalizePartNumber(job.part_number))
  );

  for (const [canonical, rows] of duplicateGroups) {
    console.log(`\n- ${canonical} (${rows.length} rows)`);
    for (const row of rows) {
      console.log(
        `  part_id=${row.id} part_number="${row.part_number}" created=${row.created_at ?? 'n/a'} updated=${row.updated_at ?? 'n/a'}`
      );
    }

    const jobsForPart = affectedJobs.filter(
      (job) => normalizePartNumber(job.part_number) === canonical
    );
    if (jobsForPart.length > 0) {
      console.log(`  linked jobs (${jobsForPart.length}):`);
      for (const job of jobsForPart.slice(0, 20)) {
        console.log(
          `    job_id=${job.id} job_code=${job.job_code ?? 'n/a'} part_number="${job.part_number}" part_id=${job.part_id ?? 'null'} updated=${job.updated_at ?? 'n/a'}`
        );
      }
      if (jobsForPart.length > 20) {
        console.log(`    ... ${jobsForPart.length - 20} more jobs`);
      }
    }
  }
}

main().catch((error) => {
  console.error('Unexpected diagnostic failure:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
