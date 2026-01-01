# Explore Summaries Research

## 1. Problem Statement
The /explore page (route: `/explanations`) currently displays article cards with truncated raw content (4-line clamp). This doesn't provide optimal discoverability, SEO, or search relevance. We need to generate structured summaries for articles to improve all three.

## 2. High Level Summary
Generate AI-powered structured summaries for articles containing:
- **Teaser** (1-2 sentences): For card display on /explore
- **Meta description**: For SEO and social sharing
- **Keywords array**: For search enhancement

Summaries generated on-publish using `gpt-4.1-nano` (cheapest model, already integrated). One-time backfill script for existing articles.

## 3. Documents Read
- `/docs/docs_overall/start_project.md` - Project setup requirements
- `/docs/docs_overall/project_instructions.md` - Execution instructions

## 4. Code Files Read

### Explore Page Components
| File | Purpose |
|------|---------|
| `/src/app/explanations/page.tsx` | Server component, fetches data via `getRecentExplanations()` |
| `/src/components/explore/ExplanationCard.tsx` | Renders card with title, 4-line content preview, date, views |
| `/src/components/explore/ExploreGalleryPage.tsx` | Main container with MasonryGrid layout |

### Data Layer
| File | Purpose |
|------|---------|
| `/src/lib/services/explanations.ts` | CRUD operations for explanations table |
| `/src/lib/schemas/schemas.ts` | Zod schemas including `ExplanationFullDbType`, `ExplanationWithViewCount` |
| `/supabase/migrations/` | Database migrations |

### Summarization Pattern (existing)
| File | Purpose |
|------|---------|
| `/src/lib/services/sourceSummarizer.ts` | Uses `gpt-4.1-nano` via `callOpenAIModel()` for source summarization |
| `/src/lib/services/llms.ts` | LLM abstraction layer, defines `lighter_model` constant |

### Article Creation Flow
| File | Purpose |
|------|---------|
| `/src/lib/services/returnExplanation.ts` | Main explanation generation pipeline |
| `/src/actions/actions.ts` | `saveExplanationAndTopic()` - DB insert point |

### Key Integration Point
The article creation flow in `returnExplanation.ts`:
1. `generateNewExplanation()` creates content
2. `saveExplanationAndTopic()` inserts to DB (returns `newExplanationId`)
3. Post-save tasks run in parallel (tags, heading links, link candidates)

**Summary generation should be added as a parallel post-save task** after `saveExplanationAndTopic()` succeeds.
