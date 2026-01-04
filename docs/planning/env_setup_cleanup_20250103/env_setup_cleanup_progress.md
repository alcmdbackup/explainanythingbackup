# Environment Setup Cleanup - Progress

## Phase 1: Create Documentation
**Status**: Not Started

### Work Done
- (pending)

### Issues Encountered
- (none yet)

### User Clarifications
- Confirmed Vercel URL: explainanything.vercel.app
- Confirmed staging environment is needed and should be fixed
- Confirmed sensitive files should be gitignored
- Confirmed full documentation file should be created

---

## Phase 2: Create .env.example Template
**Status**: Not Started

### Work Done
- (pending)

### Issues Encountered
- (none yet)

---

## Phase 3: Secure Sensitive Files
**Status**: Not Started

### Work Done
- (pending)

### Issues Encountered
- (none yet)

---

## Phase 4: Fix .env.stage
**Status**: Not Started

### Work Done
- (pending)

### Issues Encountered
- (none yet)

---

## Phase 5: GitHub Secrets Consolidation
**Status**: In Progress

### Goal
Consolidate GitHub secrets using environments for everything:
- Repository secrets: Only shared API keys (OpenAI, Pinecone)
- Development environment: Dev database credentials + test users
- Production environment: Prod database credentials + test users (same names)

### Work Done
- [x] Added plan to `env_setup_cleanup_planning.md` (Section 9)
- [x] Updated `ci.yml` - added `environment: Development` to integration-tests, e2e-critical, e2e-full jobs
- [x] Updated `e2e-nightly.yml` - added `environment: Development` to e2e-full job
- [x] Updated `post-deploy-smoke.yml` - changed `PROD_TEST_USER_*` to `TEST_USER_*`
- [x] Updated `environments.md` with new secrets structure

### Manual Steps Required (in GitHub UI)
- [ ] Create "Development" environment in GitHub Settings → Environments
- [ ] Add secrets to Development environment:
  - `NEXT_PUBLIC_SUPABASE_URL` (dev)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (dev)
  - `SUPABASE_SERVICE_ROLE_KEY` (dev)
  - `PINECONE_INDEX_NAME_ALL` = `explainanythingdevlarge`
  - `PINECONE_NAMESPACE` = `test`
  - `TEST_USER_EMAIL` (dev test user)
  - `TEST_USER_PASSWORD` (dev test user)
  - `TEST_USER_ID` (dev test user)
- [ ] Update Production environment:
  - Rename `PROD_TEST_USER_EMAIL` → `TEST_USER_EMAIL`
  - Rename `PROD_TEST_USER_PASSWORD` → `TEST_USER_PASSWORD`
  - Rename `PROD_TEST_USER_ID` → `TEST_USER_ID`
- [ ] Keep at repository level (shared):
  - `OPENAI_API_KEY`
  - `PINECONE_API_KEY`
- [ ] Delete old repository-level secrets (after verifying workflows work)

### Issues Encountered
- (none yet)
