#!/usr/bin/env node
/**
 * Install / refresh the worktrackpro-context Claude skill. Committed — anyone can run it.
 *
 *   node scripts/sync-wtp-skill.mjs           # render from live code + install to ~/.claude/skills/
 *   node scripts/sync-wtp-skill.mjs --check    # report drift only, write nothing (exit 1 if stale)
 *
 * Source of truth:  docs/skills/worktrackpro-context.SKILL.md
 * The AUTO:* regions are filled from live code (job statuses, inventory categories, rates) so they
 * never drift. The rendered skill is written back to the source AND installed to your user skills
 * dir (~/.claude/skills/worktrackpro-context/SKILL.md) — no desktop UI needed, like any skill.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const CHECK = process.argv.includes('--check');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO, 'docs/skills/worktrackpro-context.SKILL.md');

const read = (p) => readFileSync(p, 'utf8');

// --- extractors (defensive: return [] / {} on no match; callers keep old region) ---
function extractUnion(src, typeName) {
  const m = src.match(new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
}
function extractRates(types) {
  const block = types.match(/const defaults:\s*AdminSettings\s*=\s*{([\s\S]*?)\n};/);
  if (!block) return {};
  const grab = (k) => {
    const mm = block[1].match(new RegExp(`${k}:\\s*([0-9.]+)`));
    return mm ? mm[1] : null;
  };
  return {
    laborRate: grab('laborRate'),
    cncRate: grab('cncRate'),
    printer3DRate: grab('printer3DRate'),
    materialUpcharge: grab('materialUpcharge'),
    overtimeMultiplier: grab('overtimeMultiplier'),
  };
}

const codes = (arr) => arr.map((s) => `\`${s}\``).join(' · ');

// --- build the AUTO region payloads from code ---
const typesSrc = read(path.join(REPO, 'src/core/types.ts'));
const settingsSrc = read(path.join(REPO, 'src/contexts/SettingsContext.tsx'));

const statuses = extractUnion(typesSrc, 'JobStatus');
const categories = extractUnion(typesSrc, 'InventoryCategory');
const r = extractRates(settingsSrc);

const regions = {
  JOB_STATUSES: statuses.length ? codes(statuses) : null,
  INVENTORY_CATEGORIES: categories.length ? codes(categories) : null,
  RATES:
    r.laborRate && r.cncRate && r.printer3DRate && r.materialUpcharge && r.overtimeMultiplier
      ? `Labor $${r.laborRate}/hr · CNC $${r.cncRate}/hr · 3D-print $${r.printer3DRate}/hr · ` +
        `material upcharge ${r.materialUpcharge}× · overtime ${r.overtimeMultiplier}× ` +
        `(defaults; admin-overridable in Settings)`
      : null,
};

// --- fail LOUD if any extractor came up empty — silent staleness is the one thing to avoid ---
const failed = Object.entries(regions)
  .filter(([, b]) => b == null)
  .map(([n]) => n);
if (failed.length) {
  console.error(
    `✗ extraction FAILED for [${failed.join(', ')}] — a source refactor likely broke a parser in ` +
      `scripts/sync-wtp-skill.mjs. Skill NOT updated (it would silently freeze stale values). Fix + re-run.`,
  );
  process.exit(1);
}

// --- render ---
if (!existsSync(SRC)) {
  console.error(`source not found: ${SRC} — run this from a checkout of the repo.`);
  process.exit(1);
}
let out = read(SRC);
const applied = [];
const missing = [];
for (const [name, body] of Object.entries(regions)) {
  const re = new RegExp(`(<!-- AUTO:${name} -->)[\\s\\S]*?(<!-- /AUTO:${name} -->)`);
  if (!re.test(out)) {
    missing.push(name);
    continue;
  }
  out = out.replace(re, (_m, open, close) => `${open}\n${body}\n${close}`);
  applied.push(name);
}
if (missing.length) {
  console.error(
    `✗ AUTO marker(s) missing from source [${missing.join(', ')}] — docs/skills/worktrackpro-context.SKILL.md ` +
      `is malformed; restore the <!-- AUTO:NAME -->…<!-- /AUTO:NAME --> markers, then re-run.`,
  );
  process.exit(1);
}

// --- install target: the standard user skills dir (portable; works for anyone, no UI) ---
const HOME_SKILL = path.join(os.homedir(), '.claude', 'skills', 'worktrackpro-context', 'SKILL.md');
const targets = [HOME_SKILL];

// --- check mode: report drift, write nothing ---
if (CHECK) {
  const stale = [];
  if (read(SRC) !== out) stale.push(SRC);
  for (const t of targets) if (!existsSync(t) || read(t) !== out) stale.push(t);
  if (stale.length) {
    console.log(`STALE (${stale.length}) — run \`node scripts/sync-wtp-skill.mjs\` to refresh:`);
    stale.forEach((s) => console.log('  ' + s));
    process.exit(1);
  }
  console.log('up to date ✓  (statuses: ' + statuses.length + ', categories: ' + categories.length + ')');
  process.exit(0);
}

// --- write: repo source-of-truth + install to user skills dir ---
writeFileSync(SRC, out);
console.log(`refreshed AUTO regions [${applied.join(', ')}] in ${path.relative(REPO, SRC)}`);
for (const t of targets) {
  mkdirSync(path.dirname(t), { recursive: true });
  writeFileSync(t, out);
  console.log('  installed → ' + t);
}
