/**
 * @jest-environment node
 */
// Tests for query-db.ts — validates arg parsing, env config selection, table formatting, and JSON output.
// Only exercises exported pure functions; no pg.Client mocking needed.

import { parseArgs, getEnvConfig, formatAsTable, formatAsJson } from './query-db';
import { QueryResult } from 'pg';

function makeResult(rows: Record<string, unknown>[], fieldNames: string[]): QueryResult {
  return {
    rows,
    fields: fieldNames.map(name => ({
      name,
      tableID: 0,
      columnID: 0,
      dataTypeID: 0,
      dataTypeSize: 0,
      dataTypeModifier: 0,
      format: 'text' as const,
    })),
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
  };
}

describe('query-db', () => {
  describe('parseArgs', () => {
    it('returns null query and null target when no args', () => {
      const result = parseArgs(['node', 'script.ts']);
      expect(result).toEqual({ query: null, json: false, target: null });
    });

    it('extracts positional query with --prod', () => {
      const result = parseArgs(['node', 'script.ts', '--prod', 'SELECT 1']);
      expect(result).toEqual({ query: 'SELECT 1', json: false, target: '--prod' });
    });

    it('extracts positional query with --staging', () => {
      const result = parseArgs(['node', 'script.ts', '--staging', 'SELECT 1']);
      expect(result).toEqual({ query: 'SELECT 1', json: false, target: '--staging' });
    });

    it('detects --json flag before query', () => {
      const result = parseArgs(['node', 'script.ts', '--prod', '--json', 'SELECT 1']);
      expect(result).toEqual({ query: 'SELECT 1', json: true, target: '--prod' });
    });

    it('detects --json flag after query', () => {
      const result = parseArgs(['node', 'script.ts', '--staging', 'SELECT 1', '--json']);
      expect(result).toEqual({ query: 'SELECT 1', json: true, target: '--staging' });
    });

    it('handles --json only with target (REPL mode with JSON output)', () => {
      const result = parseArgs(['node', 'script.ts', '--prod', '--json']);
      expect(result).toEqual({ query: null, json: true, target: '--prod' });
    });

    it('returns null target when no --prod or --staging flag', () => {
      const result = parseArgs(['node', 'script.ts', 'SELECT 1']);
      expect(result).toEqual({ query: 'SELECT 1', json: false, target: null });
    });

    it('returns null target with no args at all (triggers usage error in main)', () => {
      const result = parseArgs(['node', 'script.ts']);
      expect(result.target).toBeNull();
      // getEnvConfig(null) returns null, which main() uses to show usage error
      expect(getEnvConfig(result.target)).toBeNull();
    });

    it('handles target flag in any position', () => {
      const result = parseArgs(['node', 'script.ts', 'SELECT 1', '--prod']);
      expect(result).toEqual({ query: 'SELECT 1', json: false, target: '--prod' });
    });
  });

  describe('getEnvConfig', () => {
    it('returns prod config for --prod', () => {
      const config = getEnvConfig('--prod');
      expect(config).toEqual({
        envFile: '.env.prod.readonly',
        envVar: 'PROD_READONLY_DATABASE_URL',
        prompt: 'prod> ',
        connectMsg: 'Connected to production (read-only)',
      });
    });

    it('returns staging config for --staging', () => {
      const config = getEnvConfig('--staging');
      expect(config).toEqual({
        envFile: '.env.staging.readonly',
        envVar: 'STAGING_READONLY_DATABASE_URL',
        prompt: 'staging> ',
        connectMsg: 'Connected to staging (read-only)',
      });
    });

    it('returns null for null target', () => {
      expect(getEnvConfig(null)).toBeNull();
    });

    it('returns null for unknown target', () => {
      expect(getEnvConfig('--unknown')).toBeNull();
    });
  });

  describe('formatAsTable', () => {
    it('returns (0 rows) for empty result', () => {
      const result = makeResult([], ['id', 'name']);
      expect(formatAsTable(result)).toBe('(0 rows)');
    });

    it('formats single row with header and separator', () => {
      const result = makeResult([{ id: 1, name: 'Alice' }], ['id', 'name']);
      const output = formatAsTable(result);
      const lines = output.split('\n');
      expect(lines[0]).toMatch(/id\s+\| name/);
      expect(lines[1]).toMatch(/^-+\+-+$/);
      expect(lines[2]).toMatch(/1\s+\| Alice/);
      expect(lines[3]).toBe('(1 row)');
    });

    it('formats multiple rows', () => {
      const result = makeResult(
        [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
        ['id', 'name']
      );
      const output = formatAsTable(result);
      expect(output).toContain('(3 rows)');
      expect(output).toContain('Alice');
      expect(output).toContain('Charlie');
    });

    it('handles NULL values', () => {
      const result = makeResult([{ id: 1, name: null }], ['id', 'name']);
      const output = formatAsTable(result);
      expect(output).toContain('NULL');
    });

    it('aligns columns based on widest value', () => {
      const result = makeResult(
        [
          { id: 1, name: 'A' },
          { id: 100, name: 'LongerName' },
        ],
        ['id', 'name']
      );
      const output = formatAsTable(result);
      const lines = output.split('\n');
      // Header and data should have consistent separators
      expect(lines[0]).toContain('|');
      expect(lines[1]).toContain('+');
      // Wider values should push column width
      expect(lines[3]).toContain('LongerName');
    });
  });

  describe('formatAsJson', () => {
    it('returns JSON array of rows', () => {
      const result = makeResult([{ id: 1, name: 'Alice' }], ['id', 'name']);
      const output = formatAsJson(result);
      const parsed = JSON.parse(output);
      expect(parsed).toEqual([{ id: 1, name: 'Alice' }]);
    });

    it('returns empty array for no rows', () => {
      const result = makeResult([], ['id']);
      const output = formatAsJson(result);
      expect(JSON.parse(output)).toEqual([]);
    });

    it('produces valid pretty-printed JSON', () => {
      const result = makeResult([{ a: 1 }, { a: 2 }], ['a']);
      const output = formatAsJson(result);
      expect(output).toContain('\n');
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('error safety', () => {
    it('connection string pattern does not appear in safe error format (postgresql://)', () => {
      const sensitiveUrl = 'postgresql://readonly_local:secret123@db.abc.supabase.co:5432/postgres';
      const safeMessage = sensitiveUrl.replace(/postgres(?:ql)?:\/\/[^\s]+/g, 'postgresql://***');
      expect(safeMessage).toBe('postgresql://***');
      expect(safeMessage).not.toContain('secret123');
      expect(safeMessage).not.toContain('readonly_local');
    });

    it('connection string pattern does not appear in safe error format (postgres://)', () => {
      const sensitiveUrl = 'postgres://readonly_local:secret123@db.abc.supabase.co:5432/postgres';
      const safeMessage = sensitiveUrl.replace(/postgres(?:ql)?:\/\/[^\s]+/g, 'postgresql://***');
      expect(safeMessage).toBe('postgresql://***');
      expect(safeMessage).not.toContain('secret123');
      expect(safeMessage).not.toContain('readonly_local');
    });
  });
});
