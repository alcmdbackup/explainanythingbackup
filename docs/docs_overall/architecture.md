# Architecture

## Tech Stack

**Frontend**
- Next.js 15 (App Router) + React 19 + TypeScript (strict mode)
- Tailwind CSS 4.0 with typography plugin
- Lexical Editor for rich text editing with custom nodes
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
- Jest + React Testing Library + Playwright
- TypeScript-first development (76 test files, 21k+ LOC)

**UI & Content**
- Heroicons for icons
- KaTeX for math rendering
- react-markdown for content display

## Key Patterns

### Schema-First Development
- All data structures defined with Zod schemas
- Derive types from schemas
- Types are used to insert into Supabase tables

### Service Layer Architecture
- **13+ Domain-specific services** in `lib/services/`:
  - `explanations.ts` - CRUD operations
  - `returnExplanation.ts` - Main orchestration service
  - `vectorsim.ts` - Pinecone embedding operations
  - `findMatches.ts` - Similarity matching with diversity scoring
  - `tags.ts`, `explanationTags.ts` - Tag management
  - `tagEvaluation.ts` - AI-powered tag assignment
  - `metrics.ts` - Analytics aggregation
  - `llms.ts` - OpenAI integration
  - `topics.ts`, `userLibrary.ts`, `userQueries.ts` - Additional domain services
- Services isolate business logic and are never called directly from client
- Database scripts are under `scripts/` folder
- Stored procedures for performance-critical operations

### Server Actions API
- `actions.ts` as main API gateway with 30+ exported actions
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
- Categories: Explanation CRUD, Tag Management, Library, Metrics, Vector Ops, AI Editing, Testing

### Code transparency
- Code should be self-documenting leveraging comments, Typescript types, and observability tools
- Wrap all critical functions with `withLoggingAndTracing`
- Always log using logger.debug, implemented in server_utilities or client_utilities. Never log directly to console.
- **Request ID propagation**: `RequestIdContext` flows client → server → services for distributed tracing
- **Structured error handling**:
  - Categorized error codes (INVALID_INPUT, LLM_API_ERROR, DATABASE_ERROR, etc.)
  - `handleError(error, 'functionName', context)` for consistent error processing
  - Error responses include error code, message, and context

### Authentication Flow
- Supabase Auth with email/OAuth
- Middleware-based route protection
- Server/client auth utilities

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

## Directory Structure

```
src/
├── actions/              # Server actions (API gateway layer)
├── app/                  # Next.js App Router pages
│   ├── api/             # API routes (streaming, logging, testing)
│   ├── results/         # Main explanation viewing/editing page
│   ├── explanations/    # Browse explanations
│   ├── userlibrary/     # User's saved content
│   └── login/           # Authentication
├── components/          # Reusable UI (SearchBar, TagBar, Navigation)
├── lib/
│   ├── services/        # Business logic layer (13+ services)
│   ├── schemas/         # Zod schemas for type safety
│   ├── logging/         # Observability infrastructure
│   └── utils/           # Helper functions
├── hooks/               # Custom React hooks
├── reducers/            # State management (useReducer)
├── editorFiles/         # Lexical editor + AI editing features
├── scripts/             # Database migration SQL files
├── ../docs/             # Architecture & system docs (moved outside src/)
└── testing/             # Test utilities & mocks
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

## State Management

- **React Hooks**: Local component state (useState, useEffect)
- **useReducer**: Complex state machines
  - `pageLifecycleReducer` - Replaces 12 useState calls for page lifecycle
  - `tagModeReducer` - Tag editing modes (Normal/RewriteWithTags/EditWithTags)
- **Custom Hooks**: Shared logic
  - `useExplanationLoader` - Fetch and hydrate explanation data
  - `useUserAuth` - Authentication state
- **Context API**: Request ID propagation (RequestIdContext)

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

**Pinecone:**
- Vector embeddings for semantic search
- Metadata: `explanation_id`, `topic_id`, `chunk_number`
- Namespace support for multi-tenancy