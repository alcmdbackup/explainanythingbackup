# Architecture

## Vision & Principles

**ExplainAnything** is an AI-powered publishing and discovery platform that produces high-quality explanatory content through large-scale AI generation combined with human feedback.

**Core loop**: AI generates content → humans provide feedback → content improves → repeat.

### Principles
1. **AI-Driven Generation**: LLMs draft content faster/cheaper than humans
2. **Everyone is a Creator**: AI makes editing accessible to all
3. **Maximize Feedback**: Force frequent feedback to algorithmically improve content
4. **Attribution**: Original creators receive credit for downstream uses
5. **Growth**: Measured by content creation and consumption

---

## Summary

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

## Feature Documentation

For detailed implementation of each feature, see [feature_deep_dives/](../feature_deep_dives/).

---

## Testing

Four-tier testing strategy: Unit (Jest), ESM (Node), Integration (real DB), E2E (Playwright).

See [testing_overview.md](testing_overview.md) for testing rules and quick reference commands.

See [testing_setup.md](../feature_deep_dives/testing_setup.md) for detailed configuration and patterns.

---

## Environments

Six environments: Local Dev, Unit Tests, Integration Tests, GitHub CI, Vercel Preview, Vercel Production.

See [environments.md](environments.md) for database config, env vars, Vercel setup, and observability.

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

### Design System
**Midnight Scholar Theme**: Book-inspired aesthetics with light/dark modes, custom typography (Playfair Display, Source Serif 4), and warm shadows.

See [design_style_guide.md](design_style_guide.md) for complete design system documentation.
