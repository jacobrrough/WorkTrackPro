const { execSync } = require('child_process');
const fs = require('fs');
const files = [
  'src/Dashboard.tsx',
  'src/features/admin/PartDetail.tsx',
  'src/services/api/parts.ts',
];
for (const f of files) {
  const content = execSync(`git show "HEAD:${f}"`, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  fs.writeFileSync(f, normalized, { encoding: 'utf8' });
  console.log('Normalized to LF:', f);
}
