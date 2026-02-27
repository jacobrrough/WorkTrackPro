import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localRepoRoot = path.resolve(__dirname, '..');
const localSrcDir = path.join(localRepoRoot, 'src');
const localPackageJson = path.join(localRepoRoot, 'package.json');
const localViteConfig = path.join(localRepoRoot, 'vite.config.ts');

const cloneRoot = path.join(__dirname, '.railway-build-workdir');
const targetDistDir = path.join(__dirname, 'dist');

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
  run('npm ci --include=dev', localRepoRoot);
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

  run('npm ci --include=dev', cloneRoot);
  run('npm run build', cloneRoot);
  copyBuiltDist(path.join(cloneRoot, 'dist'));
};

const hasLocalRepo =
  existsSync(localPackageJson) && existsSync(localSrcDir) && existsSync(localViteConfig);

if (hasLocalRepo) {
  buildFromLocalRepo();
} else {
  buildFromClonedRepo();
}

