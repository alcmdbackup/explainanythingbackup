# Phase 0 Dry-Run Harness

Validate the Phase 5 production-reset SQL on a staging clone of production
before ever running it on prod. Each step is idempotent enough to retry.

## Sequence

1. **PITR-restore prod → staging** (Supabase Dashboard → staging project →
   Database → Backups → Point-in-time recovery → restore at "latest"). This
   replaces staging's data + schema with prod's state. After it completes,
   re-run the staging migration apply to pull the new FK migrations on top
   if `/mainToProd` hasn't already shipped them to prod:
   ```bash
   supabase link --project-ref <STAGING_REF>
   supabase db push --include-all
   ```

2. **Capture pre-reset counts:**
   ```bash
   set -a; source .env.staging.readonly; set +a  # service-role key for staging
   npx tsx scripts/phase0-dryrun/capture-counts.ts pre > /tmp/counts-pre.json
   ```

3. **Execute the reset SQL** in Supabase Studio → staging project → SQL Editor:
   ```sql
   -- Paste contents of scripts/phase0-dryrun/reset.sql
   ```
   Note: do NOT run reset.sql via psql piped from your shell — the Studio
   editor logs the run in the project's audit log, which is what you want
   for the dry-run record.

4. **Capture post-reset counts:**
   ```bash
   npx tsx scripts/phase0-dryrun/capture-counts.ts post > /tmp/counts-post.json
   ```

5. **Verify expectations:**
   ```bash
   npx tsx scripts/phase0-dryrun/diff-counts.ts /tmp/counts-pre.json /tmp/counts-post.json
   ```
   Exit 0 = PASS. Exit 1 = FAIL with per-table reasons.

6. **Pinecone dry-run** (separate from the SQL):
   ```bash
   set -a; source .env.staging.readonly; set +a
   npx tsx scripts/reset-explainanything-pinecone.ts   # --dry-run by default
   ```
   This prints intended deletions. Do NOT pass `--apply` for the staging
   dry-run unless staging has a separate Pinecone index (most don't —
   verify before applying).

7. **Time the SQL block.** If COMMIT took > 5 min, the production reset
   needs a batched-DELETE rewrite or a maintenance window. Record actual
   elapsed time.

8. **File the report:**
   `docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/phase5-dryrun-staging.md`
   should contain:
   - PITR timestamp restored from
   - The pre + post JSON files (inline or attached)
   - diff-counts.ts output
   - SQL block elapsed time
   - Pinecone dry-run output
   - Sign-off: "Dry-run passed, prod Phase 5 unblocked"

## Refresh staging after the dry-run

The dry-run wipes staging's public data. To restore staging for everyone:
- Easiest: trigger another PITR restore from prod into staging at "latest"
- Or: re-import a staging seed if one exists

## Safety guards in this harness

- `capture-counts.ts` refuses to run against production (URL contains `ifubinffdbyewoezcidz`).
- `reset.sql` is a plain SQL file with no automation — you paste it into
  Studio, you see it, you commit it. If you accidentally point Studio at
  prod and run reset.sql, that's a real risk — verify the project ref in
  the Studio URL before clicking Run.
- The two FK changes from PR #1072 (`20260524000002_enforce_evolution_runs_explanation_fk_set_null.sql`)
  are what make this reset safe at all. If those didn't apply on staging,
  do not proceed — re-apply via `supabase db push --include-all`.
