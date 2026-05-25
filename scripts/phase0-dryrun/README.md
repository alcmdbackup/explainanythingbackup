# Explainanything DB Reset Harness

Tooling for the one-shot Phase 5 production-reset of the explainanything DB
(`split_evolution_explainanythig_into_separate_websites_20260522`). Executed
on 2026-05-24 against prod (`qbxhivoezkfbjbsctdzo`) — see
`docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/_progress.md`
for the run record. The originally-planned staging dry-run was collapsed
into the prod run (the data wasn't precious to preserve).

The harness is kept in the repo so the next destructive reset (e.g. another
content wipe years from now) has working scaffolding rather than starting
from scratch.

## What's here

- **`capture-counts.ts`** — read-only row count snapshot, one JSON per call.
  Connects via `DATABASE_URL_FOR_COUNTS` (recommended: a readonly_local DSN
  from `.env.prod.readonly` or `.env.staging.readonly`). Physical safety:
  the readonly_local role only has SELECT, so this script literally cannot
  mutate anything regardless of bugs.
- **`reset.sql`** — the actual destructive SQL block. Documents the four
  ordering gotchas we hit on first attempt (see comment header).
- **`diff-counts.ts`** — assert post-reset matches expectations
  (explainanything tables = 0, evolution + shared preserved exactly).
- **`inspect-fks.ts`** — diagnostic to query the FK graph + delete actions
  for a given target table. We used this to figure out the correct ordering
  in reset.sql after a couple of failed attempts.

## Run order

```bash
# 1. Capture pre-reset counts (read-only)
set -a; source .env.prod.readonly; set +a
DATABASE_URL_FOR_COUNTS=$PROD_READONLY_DATABASE_URL \
  npx tsx scripts/phase0-dryrun/capture-counts.ts pre \
  > /tmp/counts-pre.json

# 2. Execute the reset SQL via Supabase Studio → SQL Editor on the prod
#    project. Paste reset.sql verbatim. Verify the URL contains the prod
#    project ref before clicking Run.

# 3. Capture post-reset counts
DATABASE_URL_FOR_COUNTS=$PROD_READONLY_DATABASE_URL \
  npx tsx scripts/phase0-dryrun/capture-counts.ts post \
  > /tmp/counts-post.json

# 4. Verify
npx tsx scripts/phase0-dryrun/diff-counts.ts \
  /tmp/counts-pre.json /tmp/counts-post.json
# Exit 0 = PASS. Exit 1 = FAIL with per-table reasons.

# 5. Pinecone reset (separate from DB)
npx tsx scripts/reset-explainanything-pinecone.ts --prod        # dry-run
npx tsx scripts/reset-explainanything-pinecone.ts --prod --apply  # apply
#   Requires .env.evolution-prod with PINECONE_API_KEY + PINECONE_INDEX_NAME_ALL.
#   Apply prompts for typed confirmation "RESET EXPLAINANYTHING PINECONE".
```

## Safety story

The DSN-based capture-counts approach is preferable to a Supabase JS client
+ service-role key because:

- `readonly_local` is SELECT-only at the role level. Even with bugs in the
  script, no writes are physically possible.
- Service role keys are write-capable; protecting them in dev shell history
  is harder than just not having them.
- Linking the Supabase CLI to prod is intentionally blocked by
  `settings.json` per `docs/docs_overall/environments.md:114`.

The destructive SQL (`reset.sql`) is hand-pasted into Studio so the operator
sees the project context in the URL before clicking Run. No automated way
to point this at prod accidentally.

## FK ordering — what to do if reset.sql throws

The exact errors we hit on first attempts (instructive for future resets):

1. **`cannot truncate a table referenced in a foreign key constraint`** —
   PG's TRUNCATE checks FK existence at schema level (not data level). Fix:
   put all FK-linked tables in ONE `TRUNCATE TABLE a, b, c` statement.
2. **`violates foreign key constraint evolution_explanations_explanation_id_fkey`**
   — that FK is `NO ACTION`, not `SET NULL`. Must `UPDATE evolution_explanations SET explanation_id = NULL`
   BEFORE the `DELETE FROM explanations`.
3. **`TRUNCATE topics` fails after DELETE explanations** — even with empty
   explanations, the FK constraint persists in schema and blocks TRUNCATE.
   Use `DELETE FROM topics` instead.

`inspect-fks.ts` is parameterized over a target table — use it to dump the
FK graph before adding tables to reset.sql.
