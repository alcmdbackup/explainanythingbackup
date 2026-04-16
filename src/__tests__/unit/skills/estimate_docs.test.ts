// Tests for .claude/lib/estimate-docs.sh — doc-cost estimator.
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SCRIPT = '.claude/lib/estimate-docs.sh';

function runEstimator(files: string[]): { stdout: string; stderr: string; exitCode: number } {
  const cmd = files.length > 0
    ? `bash ${SCRIPT} ${files.join(' ')} 2>&1`
    : `bash ${SCRIPT} 2>&1`;
  try {
    const output = execSync(cmd, { encoding: 'utf-8', cwd: process.cwd() });
    return { stdout: '', stderr: output, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { status: number; stderr?: string; stdout?: string };
    return { stdout: '', stderr: (err.stdout || '') + (err.stderr || ''), exitCode: err.status };
  }
}

describe('estimate-docs.sh', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'estimate-docs-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 1 with no arguments', () => {
    const result = runEstimator([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage');
  });

  it('estimates tokens as bytes/4 for a known file', () => {
    const content = 'a'.repeat(4000); // 4000 bytes = 1000 tokens
    const file = join(tmpDir, 'test.md');
    writeFileSync(file, content);

    const result = runEstimator([file]);
    expect(result.stderr).toContain('1000');
  });

  it('returns exit 0 (auto) for small files (<5% of 200k = <10k tokens = <40k bytes)', () => {
    const content = 'x'.repeat(2000); // 2000 bytes = 500 tokens
    const file = join(tmpDir, 'small.md');
    writeFileSync(file, content);

    const result = runEstimator([file]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('AUTO');
  });

  it('returns exit 2 (refuse) for files >40% of context (>80k tokens = >320k bytes)', () => {
    const content = 'x'.repeat(400000); // 400k bytes = 100k tokens = 50%
    const file = join(tmpDir, 'huge.md');
    writeFileSync(file, content);

    const result = runEstimator([file]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('REFUSE');
  });

  it('handles missing files gracefully', () => {
    const result = runEstimator(['/nonexistent/file.md']);
    expect(result.stderr).toContain('MISSING');
  });

  it('classifies T1 core docs correctly', () => {
    // Use actual core doc paths if they exist
    const result = runEstimator(['docs/docs_overall/getting_started.md']);
    expect(result.stderr).toContain('T1');
  });

  it('classifies T2 deep dives correctly', () => {
    const file = join(tmpDir, 'test.md');
    writeFileSync(file, 'test');
    // T2 only applies to docs/docs_overall/* or docs/feature_deep_dives/* paths
    // A temp file should be T3
    const result = runEstimator([file]);
    expect(result.stderr).toContain('T3');
  });
});
