# Reddit-Style Comments Research

## 1. Problem Statement

ExplainAnything needs a Reddit-style threaded comments system on explanations to enable user discussion, feedback, and community engagement. Users should be able to post comments, reply in nested threads (max 10 levels), upvote/downvote, and edit their own comments.

## 2. High Level Summary

The feature requires:
- **Database**: Two new tables (comments, comment_votes) with RLS policies and triggers
- **Backend**: New Zod schemas, service layer, and server actions following existing patterns
- **Frontend**: New reducer, hook, and component hierarchy for threaded comments UI
- **Testing**: Unit, integration, and E2E tests

Key architectural decisions:
- Hybrid Adjacency List + Materialized Path for efficient tree queries
- Denormalized vote counts on comments for read performance
- Triggers to maintain vote counts automatically
- Soft delete to preserve thread structure

## 3. Documents Read

- `/docs/docs_overall/architecture.md` - Overall system architecture, patterns, tech stack
- `/docs/docs_overall/product_overview.md` - Product vision and user flows
- `/docs/docs_overall/start_project.md` - Project setup requirements
- `/docs/docs_overall/project_instructions.md` - Execution guidelines

## 4. Code Files Read

### Database/Schema Patterns
- `supabase/migrations/20251221210716_link_candidates.sql` - Migration structure, RLS, triggers
- `supabase/migrations/20251222000000_create_source_tables.sql` - Junction table patterns
- `src/lib/schemas/schemas.ts` - Zod schema patterns (InsertSchema, FullDbSchema)

### Service Layer Patterns
- `src/lib/services/userLibrary.ts` - CRUD service pattern, assertUserId, fire-and-forget metrics
- `src/lib/services/metrics.ts` - Stored procedure calls, service client usage

### Server Actions Patterns
- `src/actions/actions.ts` - withLogging, serverReadRequestId, return format

### Frontend Patterns
- `src/reducers/tagModeReducer.ts` - Reducer pattern with typed actions
- `src/hooks/useExplanationLoader.ts` - Data loading hook pattern
- `src/components/TagBar.tsx` - Complex component with state management

### Testing Patterns
- `src/__tests__/e2e/fixtures/auth.ts` - E2E auth fixtures
- `src/__tests__/e2e/helpers/pages/` - Page Object Model pattern
- `src/testing/` - Mock and fixture patterns
