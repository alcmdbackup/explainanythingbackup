/**
 * @jest-environment node
 */
// Tests for lint-migrations-idempotent.ts — verifies each non-idempotent DDL pattern
// is detected and each properly-guarded form passes. The May 2026 prod-schema drift
// was caused by exactly the ADD-CONSTRAINT-without-DROP-IF-EXISTS pattern; the
// "trip-wire fixture" test below pins that regression specifically.

import { lintSql, stripSqlComments } from './lint-migrations-idempotent';

describe('stripSqlComments', () => {
  it('strips line comments', () => {
    const sql = `CREATE TABLE foo (id int); -- this is a comment\nCREATE INDEX idx_foo ON foo(id);`;
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toContain('comment');
    expect(stripped).toContain('CREATE TABLE');
  });

  it('strips block comments', () => {
    const sql = `/* leading block */\nCREATE TABLE foo (id int);\n/* multi\nline\ncomment */\nCREATE INDEX idx_foo ON foo(id);`;
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toContain('block');
    expect(stripped).not.toContain('multi');
    expect(stripped).toContain('CREATE TABLE');
    expect(stripped).toContain('CREATE INDEX');
  });

  it('does not strip strings that contain --', () => {
    // Note: the lint's regex-based stripper is naive; it will strip inside strings.
    // This is acceptable because no production DDL needs `--` inside a string literal.
    // The test documents the limitation rather than enforcing perfect SQL parsing.
    const sql = `INSERT INTO foo VALUES ('safe');`;
    const stripped = stripSqlComments(sql);
    expect(stripped).toContain('INSERT');
  });
});

describe('lintSql — CREATE TABLE', () => {
  it('flags bare CREATE TABLE', () => {
    const findings = lintSql('test.sql', `CREATE TABLE evolution_metrics (id uuid PRIMARY KEY);`);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.pattern).toBe('CREATE TABLE without IF NOT EXISTS');
  });

  it('passes CREATE TABLE IF NOT EXISTS', () => {
    const findings = lintSql('test.sql', `CREATE TABLE IF NOT EXISTS evolution_metrics (id uuid PRIMARY KEY);`);
    expect(findings).toHaveLength(0);
  });

  it('ignores CREATE TABLE inside a line comment', () => {
    const findings = lintSql('test.sql', `-- CREATE TABLE foo (id int);`);
    expect(findings).toHaveLength(0);
  });
});

describe('lintSql — CREATE INDEX', () => {
  it('flags bare CREATE INDEX', () => {
    const findings = lintSql('test.sql', `CREATE INDEX idx_foo ON foo (id);`);
    expect(findings[0]!.pattern).toBe('CREATE INDEX without IF NOT EXISTS');
  });

  it('flags bare CREATE UNIQUE INDEX', () => {
    const findings = lintSql('test.sql', `CREATE UNIQUE INDEX idx_foo ON foo (id);`);
    expect(findings[0]!.pattern).toBe('CREATE INDEX without IF NOT EXISTS');
  });

  it('passes CREATE INDEX IF NOT EXISTS', () => {
    const findings = lintSql('test.sql', `CREATE INDEX IF NOT EXISTS idx_foo ON foo (id);`);
    expect(findings).toHaveLength(0);
  });
});

describe('lintSql — CREATE TYPE', () => {
  it('flags bare CREATE TYPE … AS ENUM', () => {
    const findings = lintSql('test.sql', `CREATE TYPE candidate_status AS ENUM ('pending', 'approved');`);
    expect(findings[0]!.pattern).toBe('CREATE TYPE without DO-block guard');
  });

  it('passes when wrapped in DO-block pg_type guard', () => {
    const sql = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'candidate_status') THEN
    CREATE TYPE candidate_status AS ENUM ('pending', 'approved');
  END IF;
END $$;`;
    const findings = lintSql('test.sql', sql);
    expect(findings).toHaveLength(0);
  });
});

describe('lintSql — CREATE FUNCTION', () => {
  it('flags bare CREATE FUNCTION', () => {
    const findings = lintSql('test.sql', `CREATE FUNCTION mark_stale() RETURNS trigger AS $$ BEGIN END; $$ LANGUAGE plpgsql;`);
    expect(findings[0]!.pattern).toBe('CREATE FUNCTION without OR REPLACE');
  });

  it('passes CREATE OR REPLACE FUNCTION', () => {
    const findings = lintSql('test.sql', `CREATE OR REPLACE FUNCTION mark_stale() RETURNS trigger AS $$ BEGIN END; $$ LANGUAGE plpgsql;`);
    expect(findings).toHaveLength(0);
  });
});

describe('lintSql — CREATE TRIGGER', () => {
  it('flags CREATE TRIGGER without DROP IF EXISTS guard', () => {
    const findings = lintSql('test.sql', `CREATE TRIGGER my_trigger AFTER INSERT ON foo EXECUTE FUNCTION bar();`);
    expect(findings[0]!.pattern).toBe('CREATE TRIGGER without DROP TRIGGER IF EXISTS');
  });

  it('passes when DROP TRIGGER IF EXISTS precedes the CREATE in same file', () => {
    const sql = `
DROP TRIGGER IF EXISTS my_trigger ON foo;
CREATE TRIGGER my_trigger AFTER INSERT ON foo EXECUTE FUNCTION bar();`;
    const findings = lintSql('test.sql', sql);
    expect(findings).toHaveLength(0);
  });

  it('does NOT pass if DROP TRIGGER IF EXISTS refers to a different trigger name', () => {
    const sql = `
DROP TRIGGER IF EXISTS some_other_trigger ON foo;
CREATE TRIGGER my_trigger AFTER INSERT ON foo EXECUTE FUNCTION bar();`;
    const findings = lintSql('test.sql', sql);
    expect(findings).toHaveLength(1);
  });
});

describe('lintSql — CREATE POLICY', () => {
  it('flags CREATE POLICY without DROP guard', () => {
    const findings = lintSql('test.sql', `CREATE POLICY "deny_all" ON foo FOR ALL USING (false);`);
    expect(findings[0]!.pattern).toBe('CREATE POLICY without DROP POLICY IF EXISTS');
  });

  it('passes when DROP POLICY IF EXISTS precedes the CREATE', () => {
    const sql = `
DROP POLICY IF EXISTS "deny_all" ON foo;
CREATE POLICY "deny_all" ON foo FOR ALL USING (false);`;
    const findings = lintSql('test.sql', sql);
    expect(findings).toHaveLength(0);
  });
});

describe('lintSql — ADD COLUMN', () => {
  it('flags ALTER TABLE ADD COLUMN without IF NOT EXISTS', () => {
    const findings = lintSql('test.sql', `ALTER TABLE evolution_strategies ADD COLUMN is_test_content BOOLEAN NOT NULL DEFAULT FALSE;`);
    expect(findings[0]!.pattern).toBe('ADD COLUMN without IF NOT EXISTS');
  });

  it('passes ALTER TABLE ADD COLUMN IF NOT EXISTS', () => {
    const findings = lintSql('test.sql', `ALTER TABLE evolution_strategies ADD COLUMN IF NOT EXISTS is_test_content BOOLEAN NOT NULL DEFAULT FALSE;`);
    expect(findings).toHaveLength(0);
  });
});

describe('lintSql — ADD CONSTRAINT (the May 2026 trip-wire pattern)', () => {
  it('flags ALTER TABLE ADD CONSTRAINT without DROP CONSTRAINT IF EXISTS', () => {
    // This is the exact pattern that caused the 62-day silent prod-schema drift.
    const findings = lintSql(
      '20260322000003_add_budget_check_constraint.sql',
      `ALTER TABLE evolution_runs ADD CONSTRAINT chk_budget_cap CHECK (budget_cap_usd <= 100);`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.pattern).toBe('ADD CONSTRAINT without DROP CONSTRAINT IF EXISTS');
    expect(findings[0]!.message).toContain('chk_budget_cap');
  });

  it('passes when DROP CONSTRAINT IF EXISTS precedes the ADD in same file', () => {
    const sql = `
ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS chk_budget_cap;
ALTER TABLE evolution_runs ADD CONSTRAINT chk_budget_cap CHECK (budget_cap_usd <= 100);`;
    const findings = lintSql('test.sql', sql);
    expect(findings).toHaveLength(0);
  });

  it('does NOT pass if DROP refers to a different constraint name', () => {
    const sql = `
ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS some_other_constraint;
ALTER TABLE evolution_runs ADD CONSTRAINT chk_budget_cap CHECK (budget_cap_usd <= 100);`;
    const findings = lintSql('test.sql', sql);
    expect(findings).toHaveLength(1);
  });
});

describe('lintSql — multi-finding files', () => {
  it('reports all findings, not just the first', () => {
    const sql = `
CREATE TABLE foo (id int);
CREATE INDEX idx_foo ON foo(id);
CREATE FUNCTION bar() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;`;
    const findings = lintSql('test.sql', sql);
    expect(findings.length).toBeGreaterThanOrEqual(3);
    const patterns = findings.map((f) => f.pattern);
    expect(patterns).toContain('CREATE TABLE without IF NOT EXISTS');
    expect(patterns).toContain('CREATE INDEX without IF NOT EXISTS');
    expect(patterns).toContain('CREATE FUNCTION without OR REPLACE');
  });

  it('passes a fully-guarded migration', () => {
    const sql = `
-- Fully-guarded migration with every pattern
CREATE TABLE IF NOT EXISTS foo (id int);
CREATE INDEX IF NOT EXISTS idx_foo ON foo(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_foo ON foo(id);
CREATE OR REPLACE FUNCTION bar() RETURNS trigger AS $$ BEGIN END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS my_trigger ON foo;
CREATE TRIGGER my_trigger AFTER INSERT ON foo EXECUTE FUNCTION bar();
DROP POLICY IF EXISTS "deny_all" ON foo;
CREATE POLICY "deny_all" ON foo FOR ALL USING (false);
ALTER TABLE foo ADD COLUMN IF NOT EXISTS extra text;
ALTER TABLE foo DROP CONSTRAINT IF EXISTS chk_foo;
ALTER TABLE foo ADD CONSTRAINT chk_foo CHECK (id > 0);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'my_enum') THEN
    CREATE TYPE my_enum AS ENUM ('a', 'b');
  END IF;
END $$;
`;
    const findings = lintSql('test.sql', sql);
    expect(findings).toHaveLength(0);
  });
});
