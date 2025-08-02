# Architecture

## Tech Stack

**Frontend**
- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS 4.0 for styling
- React components with server/client separation

**Backend & Data**
- Supabase (PostgreSQL + Auth + Real-time)
- Pinecone for vector embeddings/search
- OpenAI API for LLM integration
- Zod for schema validation
- Aggregate metrics system with PostgreSQL stored procedures for performance tracking

**Observability & DevEx**
- OpenTelemetry for distributed tracing
- Structured logging with custom logger
- TypeScript-first development

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
- Domain-specific services (`explanations.ts`, `vectorsim.ts`, `metrics.ts`, etc.)
- Aggregate metrics service consolidates explanation performance data (saves, views, engagement rates)
- Database-side calculations using stored procedures for efficiency

### Server Actions API
- `actions.ts` as main API gateway
- Use actions to call services, NEVER directly call from client side
- Server-side data processing

### Code transparency
- Code should be self-documenting leveraging comments, Typescript types, and observability tools
- Wrap all critical functions with `withLoggingAndTracing`
- Always log using logger.debug, implemented in server_utilities or client_utilies. Never log directly to console.
- Structured error handling with categorization

### Authentication Flow
- Supabase Auth with email/OAuth
- Middleware-based route protection
- Server/client auth utilities

### Analytics & Performance Tracking
- Comprehensive aggregate metrics system tracks explanation performance
- Automatic consolidation of user saves and views into performance metrics
- Database-optimized calculations with PostgreSQL stored procedures
- **Detailed documentation**: See `src/documentation/AGGREGATE_METRICS_README.md`