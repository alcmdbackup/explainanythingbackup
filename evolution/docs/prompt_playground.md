# Prompt Playground

<!-- Deep dive for the evolution admin rewrite-prompt playground tool (project tool_test_rewrite_prompts_evolution_20260605). To be filled in during implementation. -->

## Overview
[To be filled during implementation]

An admin tool under `/admin/evolution/*` that lets a researcher customize a rewrite prompt + settings (temperature, model, tactic/directive), run the rewrite step in isolation against a source article/paragraph, and compare the raw outputs of multiple `{prompt, settings, model}` configurations **side by side**, with per-config cost. It invokes only the rewrite LLM call(s) — NOT a full generate→rank→evolve run.

**In-scope rewrite families (v1):**
- Generate tactics (24) — `GenerateFromPreviousArticleAgent`.
- Paragraph recombine — `ParagraphRecombineAgent` per-slot rewrite.

## Key Files
- `src/app/admin/evolution/prompt-playground/page.tsx` — [the playground UI page]
- `evolution/src/services/<playgroundActions>.ts` — [server action(s): parallel rewrite dispatch, wrapped in `adminAction`]
- `evolution/src/components/evolution/playground/**` — [config cards + side-by-side output components]

## Implementation
[To be filled during implementation]

### Reused machinery
- Prompt construction: tactic templates (`evolution/src/lib/core/tactics/generateTactics.ts`), `FORMAT_RULES`, `buildParagraphRewritePrompt.ts`.
- Single rewrite: `Agent.execute()` with an injected `EvolutionLLMClient` + standalone `V2CostTracker` (no `run_id`/claim).
- Models + temperature: `src/config/modelRegistry.ts` (`maxTemperature`), `src/config/llmPricing.ts`, `createEvolutionLLMClient`.
- Cost: per-invocation `AgentCostScope.getOwnSpent()`.

### Guardrails
- Global `LLMSpendingGate` still applies; plus a per-dispatch cost cap and a max-parallel-configs limit.
- Evolution-host-gated via `requireAdmin()`; 404 on the public host.

## Related
- [Architecture](./architecture.md)
- [Agents Overview](./agents/overview.md)
- [Strategies & Experiments](./strategies_and_experiments.md)
- [Paragraph Recombine](./paragraph_recombine.md)
- [Visualization](./visualization.md)
- [Reference](./reference.md)
