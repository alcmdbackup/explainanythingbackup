# Test Out Combined Pieces Migrated Evolution Pipeline Plan

## Background
The evolution pipeline has been migrated into `src/lib/evolution/` with a standalone CLI at `scripts/run-evolution-local.ts`. Mock runs have been verified. Now we need to test with real LLM calls using DeepSeek V3 (deepseek-chat).

## Problem
The CLI script doesn't load `.env.local` automatically, so API keys aren't available when running via `npx tsx`. Need to add dotenv loading and verify the full pipeline works with real DeepSeek API calls.

## Phased Execution Plan
1. Add dotenv loading to `scripts/run-evolution-local.ts` to read `.env.local`
2. Run minimal pipeline with DeepSeek on `filler_words.md`
3. Run full pipeline if minimal succeeds

## Testing
- Verify mock mode still works after dotenv addition
- Verify real LLM calls succeed with DeepSeek API

## Documentation Updates
- None required for this testing phase
