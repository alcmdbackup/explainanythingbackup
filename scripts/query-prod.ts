#!/usr/bin/env npx tsx
// CLI tool for safe, read-only SQL queries against production Supabase PostgreSQL.
// Uses a dedicated readonly_local role with SELECT-only privileges.

import { Client, QueryResult } from 'pg';
import * as dns from 'dns';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

// Force IPv4 — Supabase resolves to IPv6 which many networks can't reach
dns.setDefaultResultOrder('ipv4first');

dotenv.config({ path: path.resolve(process.cwd(), '.env.prod.readonly') });

// --- Exported pure functions for testability ---

export interface ParsedArgs {
  query: string | null;
  json: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let json = false;
  let query: string | null = null;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (!query) {
      query = arg;
    }
  }

  return { query, json };
}

export function formatAsTable(result: QueryResult): string {
  const { rows, fields } = result;

  if (rows.length === 0) {
    return '(0 rows)';
  }

  const columns = fields.map(f => f.name);

  // Calculate column widths (minimum = header length)
  const widths = columns.map(col => {
    const values = rows.map(row => formatCell(row[col]));
    return Math.max(col.length, ...values.map(v => v.length));
  });

  // Header row
  const header = columns.map((col, i) => col.padEnd(widths[i]!)).join(' | ');

  // Separator
  const separator = widths.map(w => '-'.repeat(w)).join('-+-');

  // Data rows
  const dataRows = rows.map(row =>
    columns.map((col, i) => formatCell(row[col]).padEnd(widths[i]!)).join(' | ')
  );

  return [header, separator, ...dataRows, `(${rows.length} ${rows.length === 1 ? 'row' : 'rows'})`].join('\n');
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function formatAsJson(result: QueryResult): string {
  return JSON.stringify(result.rows, null, 2);
}

// --- Main CLI logic ---

async function main() {
  const connectionString = process.env.PROD_READONLY_DATABASE_URL;
  if (!connectionString) {
    console.error('Missing PROD_READONLY_DATABASE_URL.');
    console.error('Copy .env.prod.readonly.example to .env.prod.readonly and fill in the connection string.');
    process.exit(1);
  }

  const { query, json } = parseArgs(process.argv);

  const client = new Client({
    connectionString,
    // Supabase pooler (*.pooler.supabase.com) uses an internal CA not in Node's
    // trust store, so rejectUnauthorized must be false for pooler connections.
    // Direct connections (db.*.supabase.co) work with ssl: true.
    ssl: { rejectUnauthorized: false },
  });

  // Graceful shutdown
  const cleanup = async () => {
    try { await client.end(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await client.connect();
    await client.query('SELECT 1');
    console.error('✅ Connected to production (read-only)');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const safeMsg = msg.replace(/postgres(?:ql)?:\/\/[^\s]+/g, 'postgresql://***');
    console.error(`Failed to connect: ${safeMsg}`);
    process.exit(1);
  }

  if (query) {
    // Single-query mode
    await executeQuery(client, query, json);
  } else {
    // Interactive REPL mode
    await repl(client, json);
  }

  await client.end();
}

async function executeQuery(client: Client, sql: string, json: boolean): Promise<void> {
  try {
    const result = await client.query(sql);
    if (json) {
      console.log(formatAsJson(result));
    } else {
      console.log(formatAsTable(result));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Query failed';
    // Strip connection details from error messages
    const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, 'postgresql://***');
    console.error(`Error: ${safeMessage}`);
    process.exitCode = 1;
  }
}

async function repl(client: Client, json: boolean): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: 'prod> ',
  });

  console.error('Type SQL queries, or \\q to exit.');
  rl.prompt();

  let buffer = '';

  for await (const line of rl) {
    const trimmed = line.trim();

    // Exit commands
    if (['\\q', 'exit', 'quit'].includes(trimmed.toLowerCase())) {
      break;
    }

    // Skip empty lines
    if (!trimmed && !buffer) {
      rl.prompt();
      continue;
    }

    // Accumulate multi-line queries until semicolon
    buffer += (buffer ? '\n' : '') + line;

    if (buffer.trimEnd().endsWith(';')) {
      await executeQuery(client, buffer, json);
      buffer = '';
    }

    rl.prompt();
  }

  // Execute any remaining buffer without semicolon
  if (buffer.trim()) {
    await executeQuery(client, buffer, json);
  }
}

// Only run when executed directly, not when imported by tests
if (!process.env.JEST_WORKER_ID) {
  main().catch(() => {
    console.error('Fatal error occurred. Check your configuration.');
    process.exit(1);
  });
}
