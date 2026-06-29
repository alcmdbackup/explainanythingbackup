// Capture helpers for /manual_run_experiment Step 5 (and /run_experiment_analysis
// Step 1's experiment_id resolution). Pure functions for: regex-extracting
// experiment_id from seed-script stdout, validating the _status.json idempotency
// contract, and resolving the project folder from the current branch.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const NEW_EXPERIMENT_RE = /experiment_id\s*=\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
// Match both "Reusing experiment <uuid>" (seedEloAgentComparisonExperiment style)
// AND "Reusing existing experiment <uuid>" (older convention). Anchored to UUID
// v4 structure so a stray SQL line `WHERE experiment_id='<uuid>'` doesn't match.
const APPEND_EXPERIMENT_RE = /Reusing(?:\s+existing)?\s+experiment\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const BRANCH_PREFIXES = ['feat/', 'fix/', 'chore/', 'docs/', 'hotfix/'];

export type IdempotencyAction = 'write' | 'noop' | 'error';

/**
 * Extract the experiment_id from a seed-script's captured stdout. Returns the
 * first matching id from either the new-experiment shape or the --append shape.
 * Returns null when no recognized shape matches (caller should error explicitly
 * rather than fall through to a silent skip).
 */
export function extractExperimentId(seedScriptStdout: string): string | null {
  if (!seedScriptStdout) return null;
  // Prefer the new-experiment shape if both appear (a fresh --apply produces it).
  const newMatch = seedScriptStdout.match(NEW_EXPERIMENT_RE);
  if (newMatch && newMatch[1]) return newMatch[1].toLowerCase();
  const appendMatch = seedScriptStdout.match(APPEND_EXPERIMENT_RE);
  if (appendMatch && appendMatch[1]) return appendMatch[1].toLowerCase();
  return null;
}

/**
 * Idempotency contract for writing experiment_id to _status.json.
 * - absent / null / undefined → write
 * - equal to captured → noop (re-run-safe)
 * - differs from captured → error (project is bound to a different experiment)
 */
export function validateStatusJsonExperimentId(
  current: string | null | undefined,
  captured: string,
): IdempotencyAction {
  if (current === null || current === undefined || current === '') return 'write';
  if (current.toLowerCase() === captured.toLowerCase()) return 'noop';
  return 'error';
}

/**
 * Strip a known branch-type prefix (feat/, fix/, chore/, docs/, hotfix/) and
 * return the expected `docs/planning/<branch-without-prefix>` path. Returns null
 * when the branch name has no recognized prefix (skill prints a warning + skips
 * the _status.json write).
 */
export function resolveProjectFolderFromBranch(branchName: string): string | null {
  if (!branchName) return null;
  for (const prefix of BRANCH_PREFIXES) {
    if (branchName.startsWith(prefix)) {
      const projectName = branchName.slice(prefix.length);
      if (!projectName) return null;
      return `docs/planning/${projectName}`;
    }
  }
  return null;
}

/** Validate a captured experiment_id parses as a UUID v4 (or any UUID-shaped string). */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value) && value.length === 36;
}

// CLI mode: dispatch on subcommand for shell-callable usage from skill specs.
//   npx tsx scripts/skills/manual-run-experiment-capture.ts extract <stdout-file>
//   npx tsx scripts/skills/manual-run-experiment-capture.ts idempotency <current|null> <captured>
//   npx tsx scripts/skills/manual-run-experiment-capture.ts resolve-folder <branch-name>
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'extract') {
    const stdoutPath = process.argv[3];
    if (!stdoutPath) {
      console.error('Usage: extract <stdout-file>');
      process.exit(2);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    const text = fs.readFileSync(stdoutPath, 'utf8');
    const id = extractExperimentId(text);
    if (id) {
      console.log(id);
      process.exit(0);
    } else {
      console.error('ERROR: could not extract experiment_id from seed-script output.');
      process.exit(1);
    }
  } else if (cmd === 'idempotency') {
    const current = process.argv[3] === 'null' ? null : process.argv[3];
    const captured = process.argv[4];
    if (!captured) {
      console.error('Usage: idempotency <current|null> <captured>');
      process.exit(2);
    }
    console.log(validateStatusJsonExperimentId(current, captured));
    process.exit(0);
  } else if (cmd === 'resolve-folder') {
    const branch = process.argv[3];
    if (!branch) {
      console.error('Usage: resolve-folder <branch-name>');
      process.exit(2);
    }
    const folder = resolveProjectFolderFromBranch(branch);
    if (folder) {
      console.log(folder);
      process.exit(0);
    } else {
      process.exit(1);
    }
  } else {
    console.error('Usage: manual-run-experiment-capture.ts {extract|idempotency|resolve-folder} ...');
    process.exit(2);
  }
}
