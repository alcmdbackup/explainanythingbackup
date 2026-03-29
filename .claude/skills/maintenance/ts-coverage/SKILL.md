---
description: "Audit TypeScript type safety in the evolution codebase"
---

## Scope
- Primary: `evolution/src/`
- Secondary: `evolution/scripts/`, `src/app/api/` (API routes touching evolution)

## Agent Angles (4 per round)
1. **Untyped Function Params/Returns** — find functions missing parameter types or explicit return types
2. **`any` Usage Audit** — catalog all `any` types, type assertions (`as any`), and `@ts-ignore` comments
3. **DB Query Type Safety** — verify Supabase queries have proper generic types and result validation
4. **Zod Schema Gaps** — find API boundaries and external data ingestion points lacking runtime validation

## Key Questions
- Which functions accept or return `any` (explicitly or implicitly)?
- Are Supabase `.from()` calls using typed generics or relying on inference?
- Do API route handlers validate request bodies with Zod or similar?
- Are there type assertions that could mask runtime errors?
