# RLS Evaluation Research

## Problem Statement
Evaluate the Row-Level Security (RLS) policies on the staging Supabase instance to ensure they are correctly configured, secure, and follow best practices.

## High Level Summary
Analyzed 17 tables with RLS enabled. Found several significant security concerns:
1. **User data tables** (userLibrary, userQueries) have proper user-based isolation
2. **Content tables** (explanations, topics, tags) are publicly readable (intentional for SEO)
3. **Admin/internal tables** have overly permissive policies allowing any authenticated user full CRUD access
4. **Missing policies** on llmCallTracking (no SELECT policy - users can't read their own data)

## Tables Analyzed (17 total)
| Table | Rows | RLS | Policy Pattern |
|-------|------|-----|----------------|
| explanations | 3,587 | ✅ | Public read, auth insert/update |
| topics | 2,512 | ✅ | Public read, auth insert |
| userQueries | 2,813 | ✅ | User-isolated read, auth insert |
| userLibrary | 1,273 | ✅ | User-isolated read, auth insert |
| llmCallTracking | 9,849 | ✅ | Auth insert only (⚠️ no read) |
| userExplanationEvents | 1,391 | ✅ | Public read, auth insert |
| tags | 11 | ✅ | Public read, auth insert |
| explanation_tags | 4,791 | ✅ | Public read, auth insert |
| explanationMetrics | 298 | ✅ | Public read, auth insert |
| testing_edits_pipeline | 612 | ✅ | Full auth CRUD |
| link_whitelist | 2 | ✅ | Full auth CRUD |
| article_heading_links | 2,293 | ✅ | Full auth CRUD |
| link_whitelist_aliases | 0 | ✅ | Full auth CRUD |
| article_link_overrides | 0 | ✅ | Full auth CRUD |
| link_whitelist_snapshot | 1 | ✅ | Full auth CRUD |
| link_candidates | 630 | ✅ | Full auth CRUD |
| candidate_occurrences | 916 | ✅ | Full auth CRUD |

## Security Advisors Findings
Supabase flagged these security issues:
1. **Function search_path mutable**: `increment_explanation_views` has mutable search_path
2. **Auth OTP long expiry**: OTP expiry set to >1 hour (recommended <1 hour)
3. **Leaked password protection disabled**: Should enable HaveIBeenPwned check
4. **Vulnerable Postgres version**: supabase-postgres-15.8.1.054 has outstanding patches

## Documents Read
- docs/docs_overall/start_project.md

## Code Files Read
- pg_policies system table (via SQL query)
