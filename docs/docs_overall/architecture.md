# Architecture

## Tech Stack

**Frontend**
- Next.js 15.2.8 (App Router) + React 19 + TypeScript (strict mode)
- Tailwind CSS 4.0.15 with typography plugin
- Lexical Editor 0.34.0 for rich text editing with custom nodes (DiffTag, StandaloneTitleLink)
- shadcn/ui components (button, card, checkbox, form, input, label, select, spinner)
- React components with server/client separation

**Backend & Data**
- Supabase (PostgreSQL + Auth + Real-time)
- Pinecone for vector embeddings/similarity search
- OpenAI API (gpt-4.1-mini, gpt-4.1-nano) for LLM integration
- Zod for runtime validation and type inference
- LangChain for text processing utilities
- Aggregate metrics system with PostgreSQL stored procedures

**Observability & DevEx**
- OpenTelemetry for distributed tracing (Grafana Cloud)
- Structured logging with custom logger (server/client)
- Jest 30 + React Testing Library + Playwright 1.56
- TypeScript-first development (80+ test files, 21k+ LOC)

**UI & Content**
- Heroicons + Lucide for icons
- KaTeX for math rendering
- react-markdown for content display
- "Midnight Scholar" design system with book-inspired aesthetics

## Key Patterns

### Schema-First Development
- All data structures defined with Zod schemas in `lib/schemas/`
- Derive types from schemas
- Types are used to insert into Supabase tables

### Service Layer Architecture
- **17 Domain-specific services** in `lib/services/`:
  - `explanations.ts` - CRUD operations
  - `returnExplanation.ts` - Main orchestration service
  - `vectorsim.ts` - Pinecone embedding operations
  - `findMatches.ts` - Similarity matching with diversity scoring
  - `tags.ts`, `explanationTags.ts` - Tag management
  - `tagEvaluation.ts` - AI-powered tag assignment
  - `metrics.ts` - Analytics aggregation
  - `llms.ts` - OpenAI integration
  - `topics.ts`, `userLibrary.ts`, `userQueries.ts` - Additional domain services
  - `linkWhitelist.ts` - Whitelist term CRUD with snapshot caching
  - `linkCandidates.ts` - Link candidate management with approval workflow
  - `linkResolver.ts` - Link resolution and application to content
  - `links.ts` - Low-level link utilities
  - `testingPipeline.ts` - AI editing test data management
- Services isolate business logic and are never called directly from client
- Database scripts are under `scripts/` folder
- Stored procedures for performance-critical operations

### Server Actions API
- `actions/actions.ts` as main API gateway with 50+ exported actions
- **Action wrapping pattern**:
  ```typescript
  // Internal service function
  const _functionName = withLogging(async function(...) { ... });

  // Exported action with request ID context
  export const functionName = serverReadRequestId(_functionName);
  ```
- All actions marked `'use server'` for Next.js App Router
- Use actions to call services, NEVER directly call from client side
- Request ID propagation via `serverReadRequestId` wrapper
- **Action Categories**:
  - Explanation CRUD (6 actions)
  - User Library (3 actions)
  - User Data/Events (2 actions)
  - Link Resolution (2 actions)
  - Tags Management (10 actions)
  - Metrics (3 actions)
  - Vector Operations (1 action)
  - AI Suggestions (2 actions)
  - Testing Pipeline (5 actions)
  - Link Whitelist CRUD (5 actions)
  - Alias Management (3 actions)
  - Link Candidates (4 actions)
  - Article Link Overrides (3 actions)

### Code Transparency
- Code should be self-documenting leveraging comments, Typescript types, and observability tools
- Wrap all critical functions with `withLogging`
- Always log using logger.debug, implemented in server_utilities or client_utilities. Never log directly to console.
- **Request ID propagation**: `RequestIdContext` flows client → server → services for distributed tracing
- **Structured error handling**:
  - Categorized error codes (INVALID_INPUT, LLM_API_ERROR, DATABASE_ERROR, etc.)
  - `handleError(error, 'functionName', context)` for consistent error processing
  - Error responses include error code, message, and context

### Authentication Flow
- Supabase Auth with email/OAuth
- Middleware-based route protection (`middleware.ts`)
- Server/client auth utilities in `lib/utils/supabase/`

### Analytics & Performance Tracking
- **Tables**: `userExplanationEvents` (raw events) → `explanationMetrics` (aggregated)
- Tracks: total saves, views, save rate per explanation
- **PostgreSQL stored procedures** for efficient batch calculations
- **Trigger-based updates**: Automatic metric refresh on events
- Background processing doesn't block UX
- **Detailed documentation**: See `docs/docs_overall/aggregate_metrics_readme.md`

### Tag System Architecture
- **Dual Tag Types**: Simple tags (individual) and preset tag collections (mutually exclusive groups)
- **Junction Table Design**: Many-to-many relationship between explanations and tags via `explanation_tags` table
- **Soft Delete Pattern**: Tags are marked as deleted rather than physically removed for data integrity
- **AI-Powered Tagging**: Automatic tag assignment using GPT-4 evaluation of content characteristics
  - Analyzes difficulty, length, teaching methods
  - Parallel execution during content generation
- **Validation Logic**: Prevents conflicting tags within preset collections
- **Service Layer**: Dedicated services for tag operations (`tags.ts`, `explanationTags.ts`, `tagEvaluation.ts`)
- **Detailed documentation**: See `docs/docs_overall/tag_system.md`

### Link System Architecture
- **Purpose**: Automatically link key terms in content to internal/external resources
- **Core Tables**:
  - `link_whitelist` - Canonical terms with descriptions and URLs
  - `link_whitelist_aliases` - Alternative names for terms (many-to-one)
  - `link_candidates` - Pending link suggestions with approval workflow
  - `article_link_overrides` - Per-article custom link overrides
  - `article_heading_links` - Cached heading links per article
  - `link_whitelist_snapshot` - Single-query fetch optimization
- **Workflow**:
  1. Terms are added to whitelist with aliases
  2. `linkResolver` scans content for matching terms
  3. Links are applied at render time (not stored in content)
  4. Candidates can be proposed and approved/rejected by admins
- **Services**: `linkWhitelist.ts`, `linkCandidates.ts`, `linkResolver.ts`, `links.ts`

### Editor System Architecture
- **Lexical Editor** with custom plugins and nodes:
  - `DiffTagNode.ts` - Custom node for showing AI suggestion diffs
  - `DiffTagHoverPlugin.tsx` - Hover controls for accepting/rejecting diffs
  - `DiffTagInlineControls.tsx` - Inline UI for diff operations
  - `StandaloneTitleLinkNode.ts` - Custom link node for titles
  - `TextRevealPlugin.tsx` - Animated text reveal effect
  - `ToolbarPlugin.tsx` - Editor toolbar
  - `importExportUtils.ts` - Markdown ↔ Lexical conversion
- **AI Suggestions**:
  - `aiSuggestion.ts` - Generate suggestions via LLM
  - `markdownASTdiff/` - AST-based markdown diffing for accurate changes
- **Editor Actions**: `editorFiles/actions/` for server actions specific to editing

## Directory Structure

```
src/
├── __mocks__/            # Jest auto-mocks for Next.js modules
├── __tests__/            # Test suites
│   ├── e2e/             # Playwright E2E tests
│   │   ├── fixtures/    # Test fixtures (auth.ts)
│   │   ├── helpers/     # API mocks, page objects
│   │   │   └── pages/   # BasePage, LoginPage, SearchPage, ResultsPage, UserLibraryPage
│   │   ├── setup/       # global-setup.ts, auth.setup.ts, global-teardown.ts
│   │   └── specs/       # Test specs organized by feature
│   │       ├── 01-auth/
│   │       ├── 02-search-generate/
│   │       ├── 03-library/
│   │       ├── 04-content-viewing/
│   │       └── 05-edge-cases/
│   └── integration/     # Jest integration tests (10+ test files)
├── actions/              # Server actions (API gateway layer)
│   ├── actions.ts       # Main file (50+ exported actions)
│   └── actions.test.ts
├── app/                  # Next.js App Router pages
│   ├── (debug)/         # Debug/test pages (9 pages)
│   │   ├── diffTest/, editorTest/, latex-test/
│   │   ├── mdASTdiff_demo/, resultsTest/, streaming-test/
│   │   ├── tailwind-test/, test-client-logging/, typography-test/
│   ├── admin/           # Admin panel
│   │   ├── page.tsx     # Admin dashboard
│   │   └── whitelist/   # Link whitelist management
│   ├── api/             # API routes
│   │   ├── client-logs/ # Client-side log ingestion
│   │   ├── returnExplanation/ # Streaming explanation generation
│   │   ├── stream-chat/ # Chat streaming endpoint
│   │   ├── test-cases/  # Test case management API
│   │   └── test-responses/ # Test response management API
│   ├── auth/            # Authentication routes
│   │   ├── callback/    # OAuth callback
│   │   └── confirm/     # Email confirmation
│   ├── error/           # Error page
│   ├── explanations/    # Browse explanations
│   ├── login/           # Login page with form actions
│   ├── results/         # Main explanation viewing/editing page
│   ├── settings/        # User settings
│   ├── userlibrary/     # User's saved content
│   ├── layout.tsx       # Root layout
│   ├── page.tsx         # Home page
│   └── globals.css      # Global styles
├── components/          # Reusable UI components
│   ├── admin/           # Admin-specific components
│   │   ├── CandidatesContent.tsx
│   │   └── WhitelistContent.tsx
│   ├── ui/              # shadcn/ui components
│   │   ├── button.tsx, card.tsx, checkbox.tsx
│   │   ├── form.tsx, input.tsx, label.tsx
│   │   ├── select.tsx, spinner.tsx
│   ├── AISuggestionsPanel.tsx
│   ├── ExplanationsTablePage.tsx
│   ├── ExploreTabs.tsx
│   ├── Navigation.tsx
│   ├── SearchBar.tsx
│   ├── TagBar.tsx
│   └── TextRevealSettings.tsx
├── contexts/            # React contexts
│   └── ThemeContext.tsx
├── editorFiles/         # Lexical editor + AI editing features
│   ├── actions/         # Editor-specific server actions
│   ├── lexicalEditor/   # Lexical implementation
│   │   ├── DiffTagNode.ts, DiffTagHoverPlugin.tsx
│   │   ├── DiffTagHoverControls.tsx, DiffTagInlineControls.tsx
│   │   ├── LexicalEditor.tsx
│   │   ├── StandaloneTitleLinkNode.ts
│   │   ├── TextRevealPlugin.tsx, ToolbarPlugin.tsx
│   │   └── importExportUtils.ts
│   ├── markdownASTdiff/ # AST-based markdown diff
│   │   ├── markdownASTdiff.ts
│   │   ├── generateTestResponses.ts, testRunner.ts
│   │   └── test_cases.txt, test_responses.txt
│   └── aiSuggestion.ts  # AI suggestion generation
├── hooks/               # Custom React hooks
│   ├── clientPassRequestId.ts
│   ├── useExplanationLoader.ts
│   ├── useStreamingEditor.ts
│   ├── useTextRevealSettings.ts
│   └── useUserAuth.ts
├── lib/
│   ├── logging/         # Observability infrastructure
│   │   └── server/automaticServerLoggingBase.ts
│   ├── schemas/         # Zod schemas for type safety
│   │   └── schemas.ts
│   ├── services/        # Business logic layer (17 services)
│   │   ├── explanations.ts, returnExplanation.ts
│   │   ├── vectorsim.ts, findMatches.ts
│   │   ├── tags.ts, explanationTags.ts, tagEvaluation.ts
│   │   ├── metrics.ts, llms.ts
│   │   ├── topics.ts, userLibrary.ts, userQueries.ts
│   │   ├── linkWhitelist.ts, linkCandidates.ts
│   │   ├── linkResolver.ts, links.ts
│   │   └── testingPipeline.ts
│   ├── utils/           # Helper functions
│   │   ├── supabase/    # Supabase client/server/middleware
│   │   │   ├── client.ts, server.ts, middleware.ts
│   │   └── formatDate.ts
│   ├── client_utilities.ts  # Client-side logging/utilities
│   ├── server_utilities.ts  # Server-side logging/utilities
│   ├── errorHandling.ts     # Error handling utilities
│   ├── prompts.ts           # LLM prompts
│   ├── requestIdContext.ts  # Request ID async context
│   ├── serverReadRequestId.ts
│   ├── supabase.ts
│   ├── textRevealAnimations.ts
│   └── utils.ts
├── middleware.ts        # Next.js middleware (auth, request ID)
├── reducers/            # State management (useReducer)
│   ├── pageLifecycleReducer.ts
│   └── tagModeReducer.ts
└── testing/             # Test utilities & infrastructure
    ├── fixtures/        # Test data
    │   ├── database-records.ts
    │   ├── llm-responses.ts
    │   └── vector-responses.ts
    ├── mocks/           # Mocked packages
    │   ├── @pinecone-database/pinecone.ts
    │   ├── @supabase/supabase-js.ts
    │   ├── openai.ts
    │   ├── openai-helpers-zod.ts
    │   └── langchain-text-splitter.ts
    ├── scripts/         # Test helper scripts
    │   ├── test_draft_vectors.js
    │   └── test_pipeline_database.js
    └── utils/           # Test helper utilities
        ├── component-test-helpers.ts
        ├── editor-test-helpers.ts
        ├── integration-helpers.ts
        ├── logging-test-helpers.ts
        ├── page-test-helpers.ts
        ├── phase9-test-helpers.ts
        └── test-helpers.ts
```

## Core Data Flow

**Query → Explanation Pipeline:**
1. User submits query via SearchBar
2. `returnExplanation` service orchestrates:
   - Generate title from query
   - Create embeddings for vector search
   - Search Pinecone for similar explanations
   - Evaluate matches with diversity scoring
   - Generate new content if no match (GPT-4 streaming)
   - AI tag evaluation (parallel)
   - Link enhancement (headings + key terms)
   - Database persistence
3. Results page displays with TagBar, metrics, save functionality

**Request Flow:**
```
Client → Server Actions → Services → External APIs/Database
         (actions.ts)     (lib/services/)   (Supabase/Pinecone/OpenAI)
```

**Link Resolution Flow:**
```
Content → linkResolver → Whitelist Lookup → Apply Links → Rendered Content
                         (+ aliases)        (at display time)
```

## State Management

- **React Hooks**: Local component state (useState, useEffect)
- **useReducer**: Complex state machines
  - `pageLifecycleReducer` - Replaces 12 useState calls for page lifecycle
  - `tagModeReducer` - Tag editing modes (Normal/RewriteWithTags/EditWithTags)
- **Custom Hooks**: Shared logic
  - `useExplanationLoader` - Fetch and hydrate explanation data
  - `useStreamingEditor` - Handle streaming content updates
  - `useTextRevealSettings` - Text reveal animation settings
  - `useUserAuth` - Authentication state
  - `clientPassRequestId` - Request ID propagation on client
- **Context API**:
  - `RequestIdContext` - Request ID propagation
  - `ThemeContext` - Theme state management

## Testing Infrastructure

### Three-Tier Testing Strategy

**Unit Tests** (Jest + jsdom)
- 80+ test files colocated with source (`.test.ts`, `.test.tsx`)
- Mocked dependencies (OpenAI, Pinecone, Supabase)
- Run: `npm run test` or `npm run test:watch`
- CI: `npm run test:ci` (2 workers, coverage)

**Integration Tests** (Jest + node)
- 10 test files in `src/__tests__/integration/`
- Real Supabase, mocked LLMs
- Sequential execution (maxWorkers=1), 30s timeout
- Tests cover: auth-flow, explanation-generation, tag-management, metrics-aggregation, logging, vector-matching, streaming-api, request-id-propagation, error-handling, explanation-update
- Run: `npm run test:integration`

**E2E Tests** (Playwright)
- Organized by feature in `src/__tests__/e2e/specs/`:
  - `01-auth/` - Authentication flows
  - `02-search-generate/` - Search and content generation
  - `03-library/` - User library operations
  - `04-content-viewing/` - Tags, viewing functionality
  - `05-edge-cases/` - Error handling
- Page Object Pattern: `BasePage`, `LoginPage`, `SearchPage`, `ResultsPage`, `UserLibraryPage`
- Fixtures: Auth fixture for authenticated tests
- Run: `npm run test:e2e`, `npm run test:e2e:ui`, `npm run test:e2e:headed`
- CI: 2 shards, chromium project

### Test Configuration
- `jest.config.js` - Unit tests (jsdom)
- `jest.integration.config.js` - Integration tests (node)
- `playwright.config.ts` - E2E tests

## Database Schema

**Core Tables:**
- `explanations` - Content storage (title, content, status, primary_topic_id)
- `topics` - Content categorization
- `tags` - Tag definitions (simple + preset collections)
- `explanation_tags` - Many-to-many junction table
- `userLibrary` - User saves
- `userQueries` - Search history with matches
- `userExplanationEvents` - Analytics events (views, saves)
- `explanationMetrics` - Aggregated performance data
- `llmCallTracking` - API usage tracking
- `testing_edits_pipeline` - AI editing test data

**Link System Tables:**
- `link_whitelist` - Canonical terms with descriptions and URLs
- `link_whitelist_aliases` - Alternative names (many-to-one to whitelist)
- `link_candidates` - Pending link suggestions (status: pending/approved/rejected)
- `article_link_overrides` - Per-article custom link overrides
- `article_heading_links` - Cached heading links per article
- `link_whitelist_snapshot` - Fast single-query fetch cache

**Pinecone:**
- Vector embeddings for semantic search
- Metadata: `explanation_id`, `topic_id`, `chunk_number`
- Namespace support for multi-tenancy

## Migrations

Located in `supabase/migrations/`:
- `20251109053825_fix_drift.sql`
- `20251216143228_fix_rls_warnings.sql`
- `20251221080336_link_whitelist_system.sql`
- `20251221100000_add_events_timestamp.sql`
- `20251221200000_add_select_policy_user_events.sql`
- `20251221210716_link_candidates.sql`

## Design System

**Midnight Scholar Theme:**
- Light mode: cream, paper, ink, gold, copper
- Dark mode: midnight, mahogany, wood, lamplight
- Typography: Playfair Display, Source Serif 4, DM Sans, JetBrains Mono
- Book-inspired shadows: warm-sm, warm-md, warm-lg, warm-xl, gold-glow
- Custom animations: quill-write, page-turn, bookmark-flutter, ink-spread, fade-up, slide-gold

## CI/CD

**GitHub Actions Workflows:**

**ci.yml** (on push/PR):
1. TypeScript check
2. Lint (ESLint)
3. Unit tests (coverage)
4. Integration tests (requires unit tests)
5. E2E tests (2 shards, requires integration tests)

**e2e-nightly.yml** (daily at 6 AM UTC):
- Full browser matrix (chromium)
- Manual trigger enabled
