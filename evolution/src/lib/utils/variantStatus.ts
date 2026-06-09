// Single source of truth for the "discarded generate variant" UI/query semantics.
// A variant is a discarded generate variant ONLY when it is an article variant
// (variant_kind='article') that its owning generate agent dropped (persisted=false).
// Paragraph-recombine variants always carry persisted=false — they are inserted via the
// sync_to_arena RPC, which never sets persisted (column DEFAULT false) — yet they are
// surfaced, not discarded. So they must never receive the generate-agent "discarded" UI.

/** True iff this variant is a generate-agent discard (article kind + persisted===false). */
export function isDiscardedGenerateVariant(
  persisted: boolean | undefined,
  variantKind: string | undefined,
): boolean {
  return persisted === false && variantKind === 'article';
}

/**
 * PostgREST `.or(...)` filter string encoding "NOT an article discard": keep a row when it is
 * surfaced (persisted=true) OR it is not an article (variant_kind != 'article' — on this schema,
 * variant_kind is NOT NULL DEFAULT 'article' CHECK IN ('article','paragraph'), so `neq.article`
 * means paragraph). Used by the default list filters so paragraph variants (always persisted=false)
 * are not silently hidden. Kept next to the predicate so the TS and PostgREST encodings of the same
 * rule stay in sync — see variantStatus.test.ts.
 */
export const NON_DISCARDED_OR_FILTER = 'persisted.eq.true,variant_kind.neq.article';
