# Architecture

## Summary

**ExplainAnything** is an AI-powered educational content platform that generates, stores, and retrieves explanations using semantic search and LLM generation.

### How It Works
```
User Query → Vector Search (Pinecone) → Match Found? → Return Existing
                                      ↓ No Match
                              Generate via GPT-4 → Tag & Store → Return New
```

### Key Architectural Decisions
- **Server Actions as API**: All client-server communication via Next.js Server Actions
- **Schema-First**: Zod schemas define all data structures; types derived from schemas
- **Service Layer**: Business logic isolated in `lib/services/`, never called from client
- **Request Tracing**: Request IDs propagate client → actions → services for observability

### At a Glance
| Metric | Value |
|--------|-------|
| Codebase | 60k+ LOC TypeScript |
| Services | 17 domain services |
| Actions | 50+ server actions |
| Tests | 80+ unit, 10 integration, 9 E2E specs |

---

## Core Data Flow

### Query → Explanation Pipeline
1. User submits query via `SearchBar`
2. `returnExplanation` service orchestrates:
   - Generate title from query
   - Create embeddings → search Pinecone for similar explanations
   - Evaluate matches with diversity scoring
   - Generate new content if no match (GPT-4 streaming)
   - AI tag evaluation (parallel)
   - Link enhancement (headings + key terms)
   - Database persistence
   - AI summary generation (fire-and-forget for explore page teasers and SEO)
3. Results page displays with `TagBar`, metrics, save functionality

### Request Flow
```
Client → Server Actions → Services → External APIs/Database
         (actions.ts)    (lib/services/)   (Supabase/Pinecone/OpenAI)
```

---

## Development Essentials

### Action Wrapping Pattern
All server actions follow this pattern for logging and request tracing:

```typescript
// Internal function with logging
const _functionName = withLogging(async function(...) { ... });

// Exported action with request ID context
export const functionName = serverReadRequestId(_functionName);
```

- Actions in `actions/actions.ts` (50+ exported)
- All marked `'use server'` for Next.js App Router
- **Never call services directly from client**

### Schema-First Development
- All data structures defined with Zod schemas in `lib/schemas/`
- Derive TypeScript types from schemas
- Types used for Supabase table inserts

### Code Transparency
- Wrap critical functions with `withLogging`
- Use `logger.debug` (from `server_utilities` or `client_utilities`), never `console.log`
- Request IDs flow via `RequestIdContext` for distributed tracing
- Structured error handling with categorized error codes

---

## Feature Systems

### Tag System
- **Dual Types**: Simple tags + preset collections (mutually exclusive groups)
- **AI-Powered**: Automatic tag assignment via GPT-4 during content generation
- **Services**: `tags.ts`, `explanationTags.ts`, `tagEvaluation.ts`
- **Details**: See `docs/docs_overall/tag_system.md`

### Link System
- **Purpose**: Auto-link key terms to internal/external resources
- **Workflow**: Terms added to whitelist → `linkResolver` scans content → Links applied at render time
- **Services**: `linkWhitelist.ts`, `linkCandidates.ts`, `linkResolver.ts`, `links.ts`

### Summary System
- **Purpose**: AI-generated summaries for explore page teasers, SEO meta descriptions, and keyword search
- **Workflow**: Article published → `explanationSummarizer` generates summary via gpt-4.1-nano → Stored in `explanations` table
- **Pattern**: Fire-and-forget (doesn't block publish flow, errors logged but not propagated)
- **Fields**: `summary_teaser` (30-50 word preview), `meta_description` (SEO, max 160 chars), `keywords` (array for search)
- **Backfill**: `scripts/backfill-summaries.ts` for existing articles

### Editor System
- **Lexical Editor** with custom plugins:
  - `DiffTagNode` - AI suggestion diffs
  - `TextRevealPlugin` - Animated text reveal
  - `importExportUtils.ts` - Markdown ↔ Lexical conversion
- **AI Editing**: Unified sidebar (`AIEditorPanel`) + modal (`AdvancedAIEditorModal`) with:
  - Dual output modes: inline-diff (CriticMarkup) or full rewrite
  - Source URL integration for context
  - Tag-based editing in modal
  - `aiSuggestion.ts` + `markdownASTdiff/` for AST-based diffing

### Authentication
- Supabase Auth (email/OAuth)
- Middleware-based route protection (`middleware.ts`)
- Utilities in `lib/utils/supabase/`

### Analytics
- Raw events (`userExplanationEvents`) → Aggregated metrics (`explanationMetrics`)
- PostgreSQL stored procedures for batch calculations
- **Details**: See `docs/docs_overall/aggregate_metrics_readme.md`

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | Next.js 15.2.8 (App Router), React 19, TypeScript (strict), Tailwind CSS 4.0.15 |
| **Editor** | Lexical 0.34.0 with custom nodes |
| **UI** | shadcn/ui, Heroicons, Lucide, KaTeX, react-markdown |
| **Backend** | Supabase (PostgreSQL + Auth), Pinecone (vectors), OpenAI API |
| **Validation** | Zod, LangChain (text processing) |
| **Observability** | OpenTelemetry (Grafana Cloud), custom structured logging |
| **Testing** | Jest 30, React Testing Library, Playwright 1.56 |

---

## Database Schema

### Core Tables
| Table | Purpose |
|-------|---------|
| `explanations` | Content storage (title, content, status, summary_teaser, meta_description, keywords) |
| `topics` | Content categorization |
| `tags` / `explanation_tags` | Tag definitions + junction table |
| `userLibrary` | User saves |
| `userQueries` | Search history with matches |
| `userExplanationEvents` | Analytics events |
| `explanationMetrics` | Aggregated metrics |

### Link System Tables
| Table | Purpose |
|-------|---------|
| `link_whitelist` | Canonical terms with URLs |
| `link_whitelist_aliases` | Alternative names |
| `link_candidates` | Pending suggestions |
| `article_link_overrides` | Per-article overrides |

### Vector Store (Pinecone)
- Embeddings with metadata: `explanation_id`, `topic_id`, `chunk_number`
- Namespace support for multi-tenancy

---

## Testing

### Three-Tier Strategy
| Tier | Tool | Location | Command |
|------|------|----------|---------|
| Unit | Jest + jsdom | Colocated `.test.ts` files | `npm test` |
| Integration | Jest + node | `__tests__/integration/` | `npm run test:integration` |
| E2E | Playwright | `__tests__/e2e/specs/` | `npm run test:e2e` |

### E2E Organization
- `01-auth/` - Authentication flows
- `02-search-generate/` - Search and generation
- `03-library/` - User library
- `04-content-viewing/` - Tags, viewing
- `05-edge-cases/` - Error handling

---

## State Management

- **Local State**: `useState`, `useEffect`
- **Complex State**: `useReducer` (`pageLifecycleReducer`, `tagModeReducer`)
- **Custom Hooks**: `useExplanationLoader`, `useStreamingEditor`, `useUserAuth`
- **Context**: `RequestIdContext`, `ThemeContext`

---

## Appendix

### Directory Structure (Top-Level)
```
src/
├── actions/          # Server actions (API gateway)
├── app/              # Next.js App Router pages
├── components/       # Reusable UI components
├── editorFiles/      # Lexical editor + AI editing
├── hooks/            # Custom React hooks
├── lib/
│   ├── schemas/      # Zod schemas
│   ├── services/     # Business logic (17 services)
│   └── utils/        # Helpers, Supabase clients
├── reducers/         # useReducer state machines
└── testing/          # Test fixtures, mocks, utilities
```

### CI/CD (GitHub Actions)
**ci.yml** (on push/PR): TypeScript → Lint → Unit tests → Integration → E2E (2 shards)

**e2e-nightly.yml**: Daily full browser matrix

### Design System
**Midnight Scholar Theme**: Book-inspired aesthetics with light/dark modes, custom typography (Playfair Display, Source Serif 4), and warm shadows.

### Migrations
Located in `supabase/migrations/` - 6 migration files for schema evolution.
