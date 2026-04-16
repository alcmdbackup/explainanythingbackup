// Tests for /initialize telemetry JSONL append logic.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

interface TelemetryRecord {
  timestamp: string;
  branch_type: string;
  steps: number;
  prompts: number;
  tokens_read_estimate: number;
  duration_s: number;
  skipped_wait: boolean;
}

function appendTelemetry(metricsDir: string, record: TelemetryRecord): void {
  const file = join(metricsDir, 'initialize.jsonl');
  const line = JSON.stringify(record) + '\n';
  writeFileSync(file, line, { flag: 'a' });
}

const ALLOWED_KEYS = new Set([
  'timestamp', 'branch_type', 'steps', 'prompts',
  'tokens_read_estimate', 'duration_s', 'skipped_wait',
]);

describe('telemetry append', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'telemetry-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleRecord: TelemetryRecord = {
    timestamp: '2026-04-15T12:00:00Z',
    branch_type: 'feat',
    steps: 9,
    prompts: 4,
    tokens_read_estimate: 4500,
    duration_s: 45,
    skipped_wait: false,
  };

  it('creates the JSONL file if it does not exist', () => {
    appendTelemetry(tmpDir, sampleRecord);
    expect(existsSync(join(tmpDir, 'initialize.jsonl'))).toBe(true);
  });

  it('appends valid JSON per line', () => {
    appendTelemetry(tmpDir, sampleRecord);
    appendTelemetry(tmpDir, { ...sampleRecord, branch_type: 'fix', steps: 6 });

    const content = readFileSync(join(tmpDir, 'initialize.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
    expect(() => JSON.parse(lines[1]!)).not.toThrow();
  });

  it('matches the expected schema', () => {
    appendTelemetry(tmpDir, sampleRecord);
    const line = readFileSync(join(tmpDir, 'initialize.jsonl'), 'utf-8').trim();
    const parsed = JSON.parse(line);
    const keys = new Set(Object.keys(parsed));
    expect(keys).toEqual(ALLOWED_KEYS);
  });

  it('does not leak branch names, project paths, or user text', () => {
    appendTelemetry(tmpDir, sampleRecord);
    const line = readFileSync(join(tmpDir, 'initialize.jsonl'), 'utf-8').trim();
    const parsed = JSON.parse(line);
    // Only allowed keys — no project_name, branch_name, summary, requirements, etc.
    for (const key of Object.keys(parsed)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
    // branch_type is a category (feat/fix/chore/docs/hotfix), not the full branch name
    expect(['feat', 'fix', 'chore', 'docs', 'hotfix']).toContain(parsed.branch_type);
  });

  it('records skipped_wait accurately', () => {
    appendTelemetry(tmpDir, { ...sampleRecord, skipped_wait: true });
    const line = readFileSync(join(tmpDir, 'initialize.jsonl'), 'utf-8').trim();
    expect(JSON.parse(line).skipped_wait).toBe(true);
  });
});
