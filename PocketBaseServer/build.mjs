import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localRepoRoot = path.resolve(__dirname, '..');
const localSrcDir = path.join(localRepoRoot, 'src');
const localPackageJson = path.join(localRepoRoot, 'package.json');
const localViteConfig = path.join(localRepoRoot, 'vite.config.ts');

const cloneRoot = path.join(__dirname, '.railway-build-workdir');
const targetDistDir = path.join(__dirname, 'dist');
const fallbackUrl = process.env.RAILWAY_FALLBACK_URL || 'https://work-track-pro-v6.vercel.app';

const run = (command, cwd) => {
  execSync(command, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
};

const copyBuiltDist = (distPath) => {
  if (!existsSync(path.join(distPath, 'index.html'))) {
    throw new Error(`Expected build output at ${distPath}`);
  }

  rmSync(targetDistDir, { recursive: true, force: true });
  cpSync(distPath, targetDistDir, { recursive: true });
};

const buildFromLocalRepo = () => {
  run('npm ci', localRepoRoot);
  run('npm run build', localRepoRoot);
  copyBuiltDist(path.join(localRepoRoot, 'dist'));
};

const buildFromClonedRepo = () => {
  const repoFromEnv =
    process.env.RAILWAY_GIT_REPO_URL ||
    (process.env.GITHUB_REPOSITORY
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}.git`
      : '');
  const repoUrl = repoFromEnv || 'https://github.com/jacobrrough/WorkTrackPro.git';

  rmSync(cloneRoot, { recursive: true, force: true });
  mkdirSync(cloneRoot, { recursive: true });

  run(`git clone --depth 1 "${repoUrl}" "${cloneRoot}"`, __dirname);

  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GITHUB_SHA ||
    '';

  if (sha) {
    try {
      run(`git -C "${cloneRoot}" fetch --depth 1 origin "${sha}"`, __dirname);
      run(`git -C "${cloneRoot}" checkout "${sha}"`, __dirname);
    } catch {
      console.warn(`Could not checkout commit ${sha}, continuing on cloned HEAD.`);
    }
  }

  run('npm ci', cloneRoot);
  run('npm run build', cloneRoot);
  copyBuiltDist(path.join(cloneRoot, 'dist'));
};

const writeFallbackDist = () => {
  const normalizedFallback = fallbackUrl.replace(/\/+$/, '');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WorkTrack Pro</title>
  <script>
    (function () {
      var base = ${JSON.stringify(normalizedFallback)};
      var target = base + window.location.pathname + window.location.search + window.location.hash;
      window.location.replace(target);
    })();
  </script>
</head>
<body>
  <p>Redirecting to WorkTrack Pro...</p>
</body>
</html>`;

  rmSync(targetDistDir, { recursive: true, force: true });
  mkdirSync(targetDistDir, { recursive: true });
  writeFileSync(path.join(targetDistDir, 'index.html'), html, 'utf8');
};

const hasLocalRepo =
  existsSync(localPackageJson) && existsSync(localSrcDir) && existsSync(localViteConfig);

try {
  if (process.env.RAILWAY_COMPAT_SKIP_BUILD === '1') {
    throw new Error('Build intentionally skipped for fallback validation.');
  }

  if (hasLocalRepo) {
    buildFromLocalRepo();
  } else {
    buildFromClonedRepo();
  }
} catch (error) {
  console.warn('Primary build path failed, writing fallback redirect dist.');
  console.warn(error instanceof Error ? error.message : String(error));
  writeFallbackDist();
}

