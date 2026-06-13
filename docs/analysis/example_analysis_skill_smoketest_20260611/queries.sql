-- ILLUSTRATIVE ONLY — not executed for this smoketest example.
-- Real /analysis runs record the exact queries used here, one per capture,
-- and paste their results into the analysis doc's "## Queries & Results" section.
-- Read-only, aggregate, no PII columns selected.

SELECT status AS category,
       count(*) AS count,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS share_pct
FROM explanations
GROUP BY status
ORDER BY count DESC;
