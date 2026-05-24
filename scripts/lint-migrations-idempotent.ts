#!/usr/bin/env npx tsx
// Scans newly-added Supabase migrations for non-idempotent DDL patterns that would
// abort the entire deploy queue on re-application. The 62-day prod-schema-drift in
// May 2026 was caused by a single non-idempotent `ADD CONSTRAINT` aborting 56
// queued migrations — this lint stops that class of bug at PR time.
//
// Only checks NEWLY-ADDED files (git diff --diff-filter=A vs the base branch) so the
// ~35 legacy non-idempotent migrations don't break CI. Phase 8 of the postmortem plan
// covers retro-fitting guards into the legacy backlog separately.
//
// Usage:
//   npx tsx scripts/lint-migrations-idempotent.ts                # vs origin/main
//   npx tsx scripts/lint-migrations-idempotent.ts --base=origin/production
//   npx tsx scripts/lint-migrations-idempotent.ts --file=<path>  # lint a single file

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- Public API (exported for unit tests) ---

export interface LintFinding {
  file: string;
  line: number;
  pattern: string;
  message: string;
  excerpt: string;
}

/**
 * Strip line comments (`-- ...`) and block comments (`/* ... *​/`) from SQL so
 * regex matches don't false-positive on commented-out DDL examples.
 */
export function stripSqlComments(sql: string): string {
  // Block comments first (multi-line)
  let stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // Then line comments
  stripped = stripped.replace(/--[^\n]*/g, '');
  return stripped;
}

/**
 * Scan a single SQL file's contents for non-idempotent DDL patterns.
 * Returns a list of findings (empty if all DDL is guarded).
 */
export function lintSql(filePath: string, sql: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const stripped = stripSqlComments(sql);
  const lines = stripped.split('\n');

  // Track ADD CONSTRAINT names and the constraint names that have a preceding
  // DROP CONSTRAINT IF EXISTS guard. The guard must appear in the same file.
  const droppedConstraints = new Set<string>();
  const droppedTriggers = new Set<string>(); // key: `${trigger}|${table}`
  const droppedPolicies = new Set<string>();  // key: `${policy}|${table}`

  // First pass: collect all guards
  for (const line of lines) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/\bDROP\s+CONSTRAINT\s+IF\s+EXISTS\s+([A-Za-z_][\w]*)/i))) {
      droppedConstraints.add(m[1]!.toLowerCase());
    }
    if ((m = line.match(/\bDROP\s+TRIGGER\s+IF\s+EXISTS\s+([A-Za-z_][\w]*)\s+ON\s+([A-Za-z_][\w.]*)/i))) {
      droppedTriggers.add(`${m[1]!.toLowerCase()}|${m[2]!.toLowerCase()}`);
    }
    if ((m = line.match(/\bDROP\s+POLICY\s+IF\s+EXISTS\s+["']?([^"'\s]+)["']?\s+ON\s+([A-Za-z_][\w.]*)/i))) {
      droppedPolicies.add(`${m[1]!.toLowerCase()}|${m[2]!.toLowerCase()}`);
    }
  }

  // Second pass: find unguarded DDL
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const excerpt = line.trim().substring(0, 120);

    // CREATE TABLE without IF NOT EXISTS
    if (/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)([A-Za-z_])/i.test(line)) {
      findings.push({
        file: filePath,
        line: lineNo,
        pattern: 'CREATE TABLE without IF NOT EXISTS',
        message: 'Use `CREATE TABLE IF NOT EXISTS foo (...)` for idempotency.',
        excerpt,
      });
    }

    // CREATE [UNIQUE] INDEX without IF NOT EXISTS
    if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)([A-Za-z_])/i.test(line)) {
      findings.push({
        file: filePath,
        line: lineNo,
        pattern: 'CREATE INDEX without IF NOT EXISTS',
        message: 'Use `CREATE [UNIQUE] INDEX IF NOT EXISTS idx ON ...` for idempotency.',
        excerpt,
      });
    }

    // CREATE TYPE (no native IF NOT EXISTS → must use DO-block guard)
    if (/\bCREATE\s+TYPE\s+([A-Za-z_][\w]*)\s+AS\b/i.test(line)) {
      // Look for a DO $$ ... pg_type guard in the surrounding 10 lines
      const window = lines.slice(Math.max(0, idx - 10), idx + 1).join('\n');
      if (!/\bDO\s+\$\$[\s\S]*pg_type[\s\S]*WHERE\s+typname/i.test(window)) {
        findings.push({
          file: filePath,
          line: lineNo,
          pattern: 'CREATE TYPE without DO-block guard',
          message:
            'Wrap in `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname=\'name\') THEN CREATE TYPE name ...; END IF; END $$;` for idempotency.',
          excerpt,
        });
      }
    }

    // CREATE FUNCTION without OR REPLACE
    if (/\bCREATE\s+FUNCTION\b/i.test(line) && !/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/i.test(line)) {
      findings.push({
        file: filePath,
        line: lineNo,
        pattern: 'CREATE FUNCTION without OR REPLACE',
        message: 'Use `CREATE OR REPLACE FUNCTION` for idempotency.',
        excerpt,
      });
    }

    // CREATE TRIGGER without preceding DROP TRIGGER IF EXISTS in same file
    let m: RegExpMatchArray | null;
    if ((m = line.match(/\bCREATE\s+TRIGGER\s+([A-Za-z_][\w]*)[\s\S]*?\bON\s+([A-Za-z_][\w.]*)/i))) {
      const triggerName = m[1]!;
      const tableName = m[2]!;
      const key = `${triggerName.toLowerCase()}|${tableName.toLowerCase()}`;
      if (!droppedTriggers.has(key)) {
        findings.push({
          file: filePath,
          line: lineNo,
          pattern: 'CREATE TRIGGER without DROP TRIGGER IF EXISTS',
          message: `Add \`DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName};\` before the CREATE for idempotency.`,
          excerpt,
        });
      }
    }

    // CREATE POLICY without preceding DROP POLICY IF EXISTS in same file
    if ((m = line.match(/\bCREATE\s+POLICY\s+["']?([^"'\s]+)["']?\s+ON\s+([A-Za-z_][\w.]*)/i))) {
      const policyName = m[1]!;
      const tableName = m[2]!;
      const key = `${policyName.toLowerCase()}|${tableName.toLowerCase()}`;
      if (!droppedPolicies.has(key)) {
        findings.push({
          file: filePath,
          line: lineNo,
          pattern: 'CREATE POLICY without DROP POLICY IF EXISTS',
          message: `Add \`DROP POLICY IF EXISTS "${policyName}" ON ${tableName};\` before the CREATE for idempotency.`,
          excerpt,
        });
      }
    }

    // ALTER TABLE ... ADD COLUMN without IF NOT EXISTS
    if (/\bALTER\s+TABLE\s+[\w.]+[\s\S]*?\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/i.test(line)) {
      findings.push({
        file: filePath,
        line: lineNo,
        pattern: 'ADD COLUMN without IF NOT EXISTS',
        message: 'Use `ALTER TABLE foo ADD COLUMN IF NOT EXISTS c ...` (Supabase runs PG 14+).',
        excerpt,
      });
    }

    // ALTER TABLE ... ADD CONSTRAINT without preceding DROP CONSTRAINT IF EXISTS
    if ((m = line.match(/\bALTER\s+TABLE\s+[\w.]+[\s\S]*?\bADD\s+CONSTRAINT\s+([A-Za-z_][\w]*)/i))) {
      const constraintName = m[1]!;
      if (!droppedConstraints.has(constraintName.toLowerCase())) {
        findings.push({
          file: filePath,
          line: lineNo,
          pattern: 'ADD CONSTRAINT without DROP CONSTRAINT IF EXISTS',
          message: `Add \`ALTER TABLE foo DROP CONSTRAINT IF EXISTS ${constraintName};\` in the same file before the ADD (PG has no native IF NOT EXISTS for constraints — this is exactly what caused the May 2026 prod-schema drift).`,
          excerpt,
        });
      }
    }
  });

  return findings;
}

/**
 * Get the list of newly-added migration files vs a base branch via git diff.
 */
export function getNewMigrationFiles(baseBranch: string, repoRoot: string): string[] {
  try {
    const output = execSync(
      `git diff --name-only --diff-filter=A ${baseBranch}...HEAD -- 'supabase/migrations/*.sql'`,
      { cwd: repoRoot, encoding: 'utf-8' },
    );
    return output
      .split('\n')
      .filter((line) => line.trim().length > 0);
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    const stderr = err.stderr?.toString() || err.message || 'unknown';
    throw new Error(`git diff failed (is ${baseBranch} a valid ref?): ${stderr}`);
  }
}

// --- CLI entrypoint ---

function main(): void {
  const args = process.argv.slice(2);
  const baseArg = args.find((a) => a.startsWith('--base='));
  const fileArg = args.find((a) => a.startsWith('--file='));
  const base = baseArg ? baseArg.replace('--base=', '') : 'origin/main';
  const repoRoot = path.resolve(__dirname, '..');

  let files: string[];
  if (fileArg) {
    files = [fileArg.replace('--file=', '')];
  } else {
    files = getNewMigrationFiles(base, repoRoot);
  }

  if (files.length === 0) {
    console.log('No newly-added migration files to lint. ✓');
    process.exit(0);
  }

  console.log(`Linting ${files.length} newly-added migration file(s) vs ${base}…\n`);

  let totalFindings = 0;
  for (const file of files) {
    const absPath = path.isAbsolute(file) ? file : path.join(repoRoot, file);
    if (!fs.existsSync(absPath)) {
      console.warn(`SKIP (file not found): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(absPath, 'utf-8');
    const findings = lintSql(file, sql);
    if (findings.length === 0) {
      console.log(`  ✓ ${file}`);
    } else {
      console.log(`  ✗ ${file} (${findings.length} finding${findings.length === 1 ? '' : 's'}):`);
      for (const f of findings) {
        console.log(`      [${f.pattern}] line ${f.line}: ${f.excerpt}`);
        console.log(`        → ${f.message}`);
      }
      totalFindings += findings.length;
    }
  }

  if (totalFindings > 0) {
    console.error(`\n✗ Migration idempotency lint FAILED: ${totalFindings} finding(s) across ${files.length} file(s).`);
    console.error('See https://github.com/Minddojo/explainanything/blob/main/docs/docs_overall/environments.md#database-migrations for the idempotency requirement.');
    process.exit(1);
  }

  console.log(`\n✓ All ${files.length} migration(s) idempotency-safe.`);
}

// Run only when invoked directly (not when imported by tests)
if (require.main === module) {
  main();
}
