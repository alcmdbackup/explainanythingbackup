# Research: Batch Run Strategy Fixes

## Problem
Batch evolution runs are not appearing in the Elo Optimization dashboard due to UUID format issues.

## Root Cause
The batch runner prefixes UUIDs with strings like `batch-` and `baseline-` which breaks database UUID columns.

## Affected Areas
1. `scripts/run-batch.ts:176` - `batch-${batchId}` prefix
2. `src/lib/evolution/core/pipeline.ts:173` - `baseline-${runId}` prefix
