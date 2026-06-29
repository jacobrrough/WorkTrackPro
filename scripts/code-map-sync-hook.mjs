#!/usr/bin/env node
/**
 * PostToolUse hook: keep docs/CODE_MAP.md in sync.
 *
 * Fires after Edit/Write/MultiEdit. If the touched file is one that CODE_MAP.md
 * tracks by path, OR is a large (>=1200-line) .ts/.tsx file, it injects a one-line
 * reminder to update the map IF the edit changed structure (renamed/added/removed a
 * top-level symbol, split the file, or extracted an abstraction).
 *
 * Advisory only: always exits 0, never blocks. Silent unless a condition matches.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BIG_FILE_LINES = 1200;

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
    }),
  );
}

try {
  const raw = readFileSync(0, 'utf8'); // stdin
  const payload = JSON.parse(raw || '{}');
  const cwd = payload.cwd || process.cwd();
  const filePath = payload.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const rel = path.relative(cwd, path.resolve(cwd, filePath));
  // Only care about source files inside the repo.
  if (rel.startsWith('..') || !/\.(ts|tsx)$/.test(rel)) process.exit(0);

  const mapPath = path.join(cwd, 'docs', 'CODE_MAP.md');
  if (!existsSync(mapPath)) process.exit(0);
  // Don't nag about editing the map itself.
  if (rel === path.join('docs', 'CODE_MAP.md')) process.exit(0);

  const map = readFileSync(mapPath, 'utf8');
  // Match the full repo-relative path (slashes normalized for Windows), OR the basename only when
  // it sits at a path boundary — so `Quotes.tsx` won't match a stray `MyQuotes.tsx` in the map.
  const relSlash = rel.split(path.sep).join('/');
  const base = path.basename(rel);
  let tracked = map.includes(relSlash);
  for (let i = map.indexOf(base); !tracked && i !== -1; i = map.indexOf(base, i + 1)) {
    if (i === 0 || !/\w/.test(map[i - 1])) tracked = true; // preceded by start or a non-word char
  }

  let isBeast = false;
  if (!tracked && existsSync(path.resolve(cwd, filePath))) {
    const lines = readFileSync(path.resolve(cwd, filePath), 'utf8').split('\n').length;
    isBeast = lines >= BIG_FILE_LINES;
  }

  if (tracked) {
    emit(
      `\`${rel}\` is tracked in docs/CODE_MAP.md. If this edit renamed/added/removed a ` +
        `top-level symbol, split the file, or extracted an abstraction, update the matching ` +
        `anchor(s) in docs/CODE_MAP.md before finishing.`,
    );
  } else if (isBeast) {
    emit(
      `\`${rel}\` is now ${BIG_FILE_LINES}+ lines but is not in docs/CODE_MAP.md. If it will be ` +
        `read often, add it (with grep-able symbol anchors) so future sessions don't read it whole.`,
    );
  }
} catch {
  // Never block on a hook error.
}
process.exit(0);
