// Tests for .claude/lib/auto_push_on_consensus.sh — auto-push helper.
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SCRIPT = join(process.cwd(), '.claude/lib/auto_push_on_consensus.sh');

function runAutoPush(
  gitDir: string,
  env: Record<string, string> = {}
): { stderr: string; exitCode: number } {
  try {
    const stderr = execSync(`bash ${SCRIPT} 2>&1`, {
      encoding: 'utf-8',
      cwd: gitDir,
      env: { ...process.env, ...env, HOME: process.env.HOME || '/tmp' },
    });
    return { stderr, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { status: number; stderr?: string; stdout?: string };
    return { stderr: (err.stderr || '') + (err.stdout || ''), exitCode: err.status ?? 1 };
  }
}

function createTempGitRepo(branch = 'feat/test'): string {
  const dir = mkdtempSync(join(tmpdir(), 'autopush-'));
  execSync(
    'git init && git config user.email "test@test.com" && git config user.name "Test" && git commit --allow-empty -m "init"',
    { cwd: dir, stdio: 'pipe' },
  );
  if (branch !== 'main') {
    execSync(`git checkout -b "${branch}"`, { cwd: dir, stdio: 'pipe' });
  }
  return dir;
}

describe('auto_push_on_consensus.sh', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips on main branch', () => {
    tmpDir = createTempGitRepo('main');
    // Stay on main (init creates main by default)
    execSync('git checkout -B main', { cwd: tmpDir, stdio: 'pipe' });
    const result = runAutoPush(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('refusing to push main');
  });

  it('skips on master branch', () => {
    tmpDir = createTempGitRepo('main');
    execSync('git checkout -B master', { cwd: tmpDir, stdio: 'pipe' });
    const result = runAutoPush(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('refusing to push main/master');
  });

  it('skips when WORKFLOW_BYPASS=true', () => {
    tmpDir = createTempGitRepo('feat/test');
    const result = runAutoPush(tmpDir, { WORKFLOW_BYPASS: 'true' });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('WORKFLOW_BYPASS');
  });

  it('skips on dirty tracked-file worktree', () => {
    tmpDir = createTempGitRepo('feat/test');
    execSync('echo "tracked" > file.txt && git add file.txt && git commit -m "add" && echo "dirty" >> file.txt', {
      cwd: tmpDir, stdio: 'pipe',
    });
    const result = runAutoPush(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('uncommitted tracked-file changes');
  });

  it('skips on stale HEAD', () => {
    tmpDir = createTempGitRepo('feat/test');
    const result = runAutoPush(tmpDir, { EXPECTED_HEAD: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('HEAD changed since consensus');
  });

  it('does not crash when block-push-on-failures.sh hook is missing', () => {
    tmpDir = createTempGitRepo('feat/test');
    // No hook exists — the script should still run fine (push will fail due to no remote, but exit 0)
    const result = runAutoPush(tmpDir);
    expect(result.exitCode).toBe(0);
    // Should get a push-failure warning (no remote configured), not a crash
    expect(result.stderr).toMatch(/push|failed|origin/i);
  });

  it('emits warning but exits 0 on push failure (no remote)', () => {
    tmpDir = createTempGitRepo('feat/test');
    const result = runAutoPush(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Auto-push failed');
  });
});
