-- Phase 0 of build_website_for_evolutiOn_20260626: add config keys for the
-- hardened LLM spending gate + the public /edit surface's cap stack.
--
-- New keys (with defaults), all read via the existing config-read pattern at
-- llmSpendingGate.ts (see checkMonthlyCap / getSpendingSummary for the read shape):
--
--   guest_user_daily_cap_usd          — $10/day per Supabase user (the GUEST_USER_ID
--                                       value caps the shared demo pool; replaces the
--                                       previously hard-coded `10` at llms.ts:988).
--   public_edit_per_ip_daily_usd      — $0.50/day per visitor IP (Upstash gate;
--                                       per-actor fairness for /edit submissions).
--   public_edit_per_region_daily_usd  — $5.00/day per Vercel-detected country
--                                       (per-region fairness; defends against
--                                       coordinated regional attacks).
--   public_edit_daily_cap_usd         — $15.00/day envelope for the public_edit
--                                       call_source category (separate from the
--                                       admin's $25/day evolution_daily_cap_usd
--                                       so /edit traffic can't starve admin work).
--
-- All keys are idempotent inserts (ON CONFLICT DO NOTHING) so re-applying the
-- migration is safe and operator overrides via UPDATE are preserved.
--
-- ROLLBACK:
-- DELETE FROM llm_cost_config WHERE key IN (
--   'guest_user_daily_cap_usd',
--   'public_edit_per_ip_daily_usd',
--   'public_edit_per_region_daily_usd',
--   'public_edit_daily_cap_usd'
-- );

INSERT INTO llm_cost_config (key, value) VALUES
  ('guest_user_daily_cap_usd',         '{"value": 10}'::jsonb),
  ('public_edit_per_ip_daily_usd',     '{"value": 0.50}'::jsonb),
  ('public_edit_per_region_daily_usd', '{"value": 5}'::jsonb),
  ('public_edit_daily_cap_usd',        '{"value": 15}'::jsonb)
ON CONFLICT (key) DO NOTHING;
