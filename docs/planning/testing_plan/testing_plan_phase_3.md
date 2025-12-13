Phase 3 Testing Plan - Tier 3 Utilities

 Scope

 Test 16 utility files across database utilities, server/client utilities, and Zod schemas.

 Implementation Strategy: 4 Sub-Phases

 Phase 3A - Quick Wins (Week 1)

 Simple, pure functions with high ROI:

 1. src/lib/prompts.ts - Snapshot tests for 6 prompt generators
 2. src/lib/utils/formatDate.ts - Date formatting edge cases
 3. src/lib/client_utilities.ts - Logger spy tests (console mocking)
 4. src/lib/serverReadRequestId.ts - Decorator behavior tests

 Effort: ~4-6 hours | Coverage Target: 90%+

 Phase 3B - Database Layer (Week 2)

 Supabase client/middleware testing:

 5. src/lib/supabase.ts - Env validation, client initialization
 6. src/lib/utils/supabase/client.ts - Client factory
 7. src/lib/utils/supabase/server.ts - Cookie handling with Next.js mocks
 8. src/lib/utils/supabase/middleware.ts - Auth flow, route protection, redirects

 Effort: ~6-8 hours | Coverage Target: 80%+

 Phase 3C - Infrastructure (Week 3)

 Critical utilities:

 9. src/lib/server_utilities.ts - File logging, env var validation
 10. src/lib/requestIdContext.ts - AsyncLocalStorage, client/server context
 11. src/lib/schemas/schemas.ts - Zod schema validation, edge cases

 Effort: ~6-8 hours | Coverage Target: 75%+

 Phase 3D - Advanced Logging (Optional)

 Complex auto-logging system (defer if time-constrained):

 12. src/lib/logging/server/automaticServerLoggingBase.ts - Core wrappers
 13-16. Other logging interceptors

 Effort: ~8-10 hours | Coverage Target: 60%+

 Testing Patterns

 - Pure functions → Snapshot + edge case tests
 - Loggers → Spy/mock verification
 - Supabase clients → Mock @supabase/ssr, verify client creation
 - Middleware → Mock Next.js Request/Response, test auth flows
 - Schemas → Valid/invalid input tests, type inference
 - Context management → AsyncLocalStorage mocking

 Total Effort

 16-32 hours depending on whether Phase 3D is included.

 Deliverables

 - 16 new .test.ts files colocated with source
 - Mock setup for Supabase, Next.js, fs operations
 - ~70-85% coverage across utilities tier
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

 Would you like to proceed?

   1. Yes, and auto-accept edits
   2. Yes, and manually approve edits
 ❯ 3. No, keep planning

 ctrl-g to edit plan in vi

9. **src/lib/server_utilities.ts** - File logging, env var validation
10. **src/lib/requestIdContext.ts** - AsyncLocalStorage, client/server context
11. **src/lib/schemas/schemas.ts** - Zod schema validation, edge cases

**Effort:** ~6-8 hours | **Coverage Target:** 75%+

### **Phase 3D - Advanced Logging (Optional)**
Complex auto-logging system (defer if time-constrained):

12. **src/lib/logging/server/automaticServerLoggingBase.ts** - Core wrappers
13-16. Other logging interceptors

**Effort:** ~8-10 hours | **Coverage Target:** 60%+

## Testing Patterns

- **Pure functions** → Snapshot + edge case tests
- **Loggers** → Spy/mock verification
- **Supabase clients** → Mock @supabase/ssr, verify client creation
- **Middleware** → Mock Next.js Request/Response, test auth flows
- **Schemas** → Valid/invalid input tests, type inference
- **Context management** → AsyncLocalStorage mocking

## Total Effort
16-32 hours depending on whether Phase 3D is included.

## Deliverables
- 16 new `.test.ts` files colocated with source
- Mock setup for Supabase, Next.js, fs operations
- ~70-85% coverage across utilities tier