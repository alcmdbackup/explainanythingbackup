# Import Articles Feature - Implementation Plan

## Summary

Feature to import AI-generated content from ChatGPT/Claude/Gemini into ExplainAnything as formatted articles.

**Brainstorm doc:** `import_articles_brainstorm.md`

---

## Phase 1: MVP Implementation

### 1. Database Migration
- Add `source` column to `explanations` table
- Values: `chatgpt | claude | gemini | other | generated | null`

### 2. Import Service (`src/lib/services/importArticle.ts`)
- `detectSource(content: string)` - heuristic source detection
- `cleanupAndReformat(content, source)` - LLM call for processing
- Zod schemas for input/output validation
- Use existing `importExportUtils.ts` for Markdown → Lexical conversion
- Apply `preprocessCriticMarkup()` and `promoteNodesAfterImport()` if needed

### 3. Server Actions (`src/actions/importActions.ts`)
- `processImport(content, source?)` - cleanup and return formatted
- `publishImportedArticle(title, content, source)` - save via existing pipeline
- Wrap with `serverReadRequestId` for request tracing
- Use `createError()`/`createValidationError()` for structured errors
- Auto-create topic from generated title via `createTopic()`

### 4. UI Components
- `ImportModal.tsx` - paste textarea, source dropdown, process button
- `ImportPreview.tsx` - Lexical editor preview, publish button
- Add import buttons to nav and home page
- Use `useReducer` for state: `idle → processing → preview → publishing → done`
- Handle error states for LLM failures

### 5. Integration
- Wire modal to navigation header
- Add button to home page
- Connect preview to existing publish flow

### 6. Post-Save Pipeline (Required Hooks)
- `processContentToStoreEmbedding()` - vector search indexing
- `evaluateTags()` + `applyTagsToExplanation()` - auto-tagging
- `generateHeadingStandaloneTitles()` - heading links
- `refreshExplanationMetrics()` - metrics initialization
- `extractLinkCandidates()` - link suggestions

### 7. Authentication & Ownership
- Require authenticated user (logged-in check)
- Set `explanation.user_id` to importing user
- RLS policies enforce user isolation

---

## Files to Create/Modify

**New:**
- `src/lib/services/importArticle.ts`
- `src/actions/importActions.ts`
- `src/components/import/ImportModal.tsx`
- `src/components/import/ImportPreview.tsx`
- `supabase/migrations/XXXXXX_add_source_column.sql`

**Modify:**
- `src/components/Header.tsx` (or nav component) - add import button
- `src/app/page.tsx` - add import button on home
- `src/lib/schemas/` - add source enum to relevant schema file

**Reuse:**
- `src/editorFiles/lexicalEditor/importExportUtils.ts` - Markdown conversion
- `src/lib/services/topics.ts` - `createTopic()`
- `src/lib/services/vectorsim.ts` - `processContentToStoreEmbedding()`
- `src/lib/services/tagEvaluation.ts` - `evaluateTags()`
- `src/lib/services/headingLinks.ts` - `generateHeadingStandaloneTitles()`

---

## Phase 2: Test Coverage

### Unit Tests

**Service Tests:** `src/lib/services/importArticle.test.ts`
- `detectSource()` - pattern matching for ChatGPT/Claude/Gemini/other
- `validateImportContent()` - empty, too short, too long, valid
- `cleanupAndReformat()` - LLM call mocking, response parsing

**Action Tests:** `src/actions/importActions.test.ts`
- `processImport()` - validation, detection, formatting flow
- `publishImportedArticle()` - topic creation, explanation save, post-save hooks
- `detectImportSource()` - lightweight detection wrapper

**Component Tests:**
- `src/components/import/ImportModal.test.tsx` - form state, auto-detect, processing
- `src/components/import/ImportPreview.test.tsx` - preview rendering, publish flow

### Integration Tests

**`src/__tests__/integration/import-articles.integration.test.ts`**
- Full import → publish flow with real database
- Verifies topic creation, explanation save, vector embedding
- Error handling and rollback scenarios

### E2E Tests

**`src/__tests__/e2e/specs/06-import/import-articles.spec.ts`**
- User flow: open modal → paste content → process → preview → publish
- Verifies redirect to article page after publish

**Page Object:** `src/__tests__/e2e/helpers/pages/ImportPage.ts`

### Test Files to Create

| File | Type |
|------|------|
| `src/lib/services/importArticle.test.ts` | Unit |
| `src/actions/importActions.test.ts` | Unit |
| `src/components/import/ImportModal.test.tsx` | Unit |
| `src/components/import/ImportPreview.test.tsx` | Unit |
| `src/__tests__/integration/import-articles.integration.test.ts` | Integration |
| `src/__tests__/e2e/specs/06-import/import-articles.spec.ts` | E2E |
| `src/__tests__/e2e/helpers/pages/ImportPage.ts` | Helper |
