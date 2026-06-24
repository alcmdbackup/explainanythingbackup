// Cross-worker mutex for the heavy full-pipeline @evolution E2E specs.
//
// Playwright runs the @evolution suite with `workers: 2` + `fullyParallel: true` (see
// playwright.config.ts — the CI evolution job runs against a LOCAL build, so isProduction is
// false). Several specs each fire a REAL evolution pipeline via a synchronous
// `POST /api/evolution/run` (iterative-editing, run-pipeline, …). When two of those execute at
// once they contend for the shared LLM provider (rate-limits + latency), the tight per-run
// budget, and the single Node test server — which intermittently starves the editing-rank step
// (variants left at the default openskill rating mu=25) and stalls pipeline completion (the run
// never reaches `completed`, so the status poll reads undefined). That is the recurring
// "iterative-editing" flake (it is contention, NOT account quota).
//
// This file lock serializes ONLY the ~2-3 pipeline specs while the ~40 fast admin specs stay
// fully parallel. The lock path is a single SHARED file (intentionally the opposite of the
// per-worker temp-file convention used for tracking data — mutual exclusion needs one shared
// lock across worker processes).

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOCK_PATH = path.join(os.tmpdir(), 'evo-e2e-pipeline.lock');
// A pipeline spec's own setTimeout is 300-600s; treat a lock older than that + buffer as stale
// (the holder crashed) and steal it, so one dead worker can't wedge the whole suite.
const STALE_MS = 12 * 60 * 1000;
const POLL_MS = 1_000;
const ACQUIRE_TIMEOUT_MS = 25 * 60 * 1000;

/** Block until this worker holds the pipeline lock (or the acquire timeout elapses, in which case
 *  we proceed best-effort rather than hang the suite). Call once at the START of a pipeline spec's
 *  beforeAll, and pair with releasePipelineLock() in a finally. */
export async function acquirePipelineLock(label: string): Promise<void> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (true) {
    try {
      // 'wx' = create + fail if it already exists → atomic test-and-set across processes.
      const fh = await fs.open(LOCK_PATH, 'wx');
      await fh.writeFile(`${label} ${Date.now()}`);
      await fh.close();
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Lock is held — steal it only if it is stale (holder crashed), otherwise wait.
      try {
        const stat = await fs.stat(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > STALE_MS) {
          await fs.rm(LOCK_PATH, { force: true });
          continue;
        }
      } catch {
        // Lock vanished between EEXIST and stat — retry the create immediately.
        continue;
      }
      if (Date.now() > deadline) {
        console.warn(`[pipeline-lock] ${label} timed out after ${ACQUIRE_TIMEOUT_MS}ms; proceeding without the lock`);
        return;
      }
      // Intentional poll interval — this is a process-level mutex helper, not a UI wait, so the
      // flakiness/no-wait-for-timeout rule (aimed at racy in-page waits) does not apply.
      // eslint-disable-next-line flakiness/no-wait-for-timeout
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

/** Release the pipeline lock. Safe to call even if not held (force-removes). */
export async function releasePipelineLock(): Promise<void> {
  await fs.rm(LOCK_PATH, { force: true });
}
