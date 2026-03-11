# Explore Running Model Locally Progress

## Phase 1: Install Ollama on Minicomputer
### Work Done
- Installed Ollama on minicomputer (GMKtec M6 Ultra, Ryzen 7640HS, 32GB DDR5)
- Configured Ollama to bind to localhost only via systemd override
- Pulled qwen2.5:14b model (~9GB)
- Initially hit OOM error: model needed 8.7GB but only 6.9GB free in Hyper-V VM
- Increased VM memory allocation via Hyper-V Manager, resolved OOM

### Issues Encountered
- **Hyper-V memory allocation**: Default VM memory was insufficient. Had to shut down VM, increase RAM to 12-16GB in Hyper-V Manager, then restart.
- **Env sourcing**: `source .env.evolution-prod` failed silently when run from wrong directory, causing "Supabase not configured" warning followed by hard failure in pipeline phase.

## Phase 2: Codebase Integration
### Work Done
- Implemented LOCAL_ prefix routing across 4 files (schemas, llms, pricing, evolution runner)
- Added unit tests for all new functionality
- Fixed pre-existing bug: prefix matching in `getModelPricing` sorted by key length descending to prevent o1 matching before o1-mini
- Extracted `validateStreamingArgs()` and `handleLLMCallError()` helpers during code simplification
- PR #669 created and CI passed

## Phase 3: Environment Configuration
### Work Done
- Added `LOCAL_LLM_BASE_URL=http://localhost:11434/v1` to minicomputer's `.env.local`

## Phase 4: Test with Evolution Run
### Work Done
- Ran test evolution with `--prompt "Test topic" --model LOCAL_qwen2.5:14b --full --iterations 1`

### Test Results (2026-03-08)
- **Speed**: Very slow on CPU-only
  - Seed title generation: ~71 seconds (vs 2-5s on cloud APIs)
  - Seed article generation (317 words): ~89 seconds (vs 2-5s on cloud APIs)
- **Quality**: Poor instruction following
  - Title generation returned reasoning/preamble instead of a clean title ("Given the prompt Test topic, there isn't a specific query or context provided. However...")
  - Model doesn't follow structured output instructions well at 14B parameter size
- **Pipeline**: Failed at agent suite phase with "supabaseUrl is required" due to env sourcing issue (not a model problem)

### Key Findings
- qwen2.5:14b on CPU is ~15-30x slower than cloud APIs — impractical for full pipeline runs
- Instruction following quality is insufficient for structured output tasks (title generation, JSON responses)
- A GPU would dramatically improve speed, or a smaller model (7B) would reduce memory pressure but likely worsen quality further

## Phase 5: Evaluate and Decide
### Status: Pending
- Local-only CPU inference with qwen2.5:14b is not viable for production evolution runs
- Potential next steps:
  - Try hybrid approach: local for cheap judging tasks, cloud for generation
  - Add a GPU to minicomputer (even a used RTX 3060 12GB would 10x speed)
  - Try a smaller model (qwen2.5:7b) for simpler tasks like tagging
  - Accept slower speed for cost savings on low-priority/batch runs
