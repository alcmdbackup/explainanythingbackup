# Typescript Enforcement Evolution Plan

## Background
Add strict TS checks, remove @ts-nocheck, and fix type errors in evolution. Also, every entity in DB should have a corresponding entry in a schema.ts file for evolution (can re-use existing if needed or create a new one) which validates all reads and writes to it. Also every function should have fully TS set up.

## Requirements (from GH Issue #NNN)
- Add strict TypeScript checks across the evolution pipeline
- Remove all @ts-nocheck directives
- Fix all type errors in evolution/
- Every DB entity must have a corresponding Zod schema entry in a schema.ts file for evolution
- All reads and writes to DB entities must be validated against their Zod schemas
- Every function must have full TypeScript type annotations (parameters, return types)

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` - may need schema/type documentation updates
- `evolution/docs/evolution/architecture.md` - may need type system architecture notes
- `evolution/docs/evolution/data_model.md` - may need Zod schema documentation
- `evolution/docs/evolution/reference.md` - may need updated file references for schema.ts
