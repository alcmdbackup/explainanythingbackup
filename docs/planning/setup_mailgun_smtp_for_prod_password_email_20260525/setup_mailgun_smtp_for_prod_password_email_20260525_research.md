# Mailgun SMTP for Prod Password Email — Research

## Why this work exists
PR #1090 (merged 2026-05-25) wired the full password-recovery flow end-to-end in code (`/forgot-password`, `/reset-password`, `/auth/confirm` recovery handling, triple gate, E2E + integration coverage). It deliberately scoped OUT the SMTP question: shipping today means recovery emails go through Supabase's default sender (`noreply@mail.app.supabase.io`), capped at ~2/hr per project, marked as testing-only, and frequently flagged as spam. This planning doc covers the next step: pointing the **prod** Supabase project at a real SMTP provider (Mailgun) so real users can actually receive reset emails.

Staging stays on Supabase default for now. The free tier of Mailgun allows exactly 1 custom domain, and prod is the only place real users hit the flow — staging's only consumer is manual checkpoint testing, which can use the Mailgun sandbox if needed later, or just keep working on the (rate-limited) Supabase default sender.

## Decision summary (user-confirmed 2026-05-25)
- **Provider**: Mailgun, US region
- **Sending domain**: `mail.explainanything.com` (subdomain, NOT apex)
- **Plan**: Free tier (100/day cap, 1 custom domain, 1-day log retention). Add a credit card to lift the sandbox "5 authorized recipients" restriction on the custom domain — no charge unless you exceed Free.
- **Scope**: PROD Supabase project (`qbxhivoezkfbjbsctdzo`) only. STAGING (`ifubinffdbyewoezcidz`) stays on Supabase default.
- **What today's PR #1090 already handles correctly**: `supabase/templates/recovery.html` template body is right (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`); no code changes needed; no env vars to add.

## Mailgun account + DNS mechanics
Researched 2026-05-25 via Mailgun help center, Supabase docs, and current pricing pages.

### Account
- Signup: https://signup.mailgun.com/new/signup?plan_name=flex_free
- No credit card required. SMS phone verification is mandatory (~5 min).
- **No-CC trap**: skipping CC entry puts you in a sandbox-like state where even your custom domain can only send to 5 pre-authorized recipients. Adding a CC (no charge) lifts that restriction. **Do this before relying on the domain for real recovery email**.

### Domain add (US region)
- Dashboard nav: **Send → Sending → Domains → Add new domain**
- Domain: `mail.explainanything.com`
- **Region is permanent per domain**. Pick US (`api.mailgun.net`, `smtp.mailgun.org`) — switching later requires recreating the domain from scratch and re-doing all DNS records.
- DKIM key length: **2048-bit** (current default).
- Leave "Create DKIM Authority" as the subdomain itself.

### DNS records to add at the registrar (relative to apex)
Five records; first two are mandatory for sending, last three are tracking/inbound:

| # | Type | Host | Value | Required for sending? |
|---|---|---|---|---|
| 1 | TXT | `mail` | `v=spf1 include:mailgun.org ~all` | **Yes** |
| 2 | TXT | `<selector>._domainkey.mail` (selector is per-domain; common values `pic`, `k1`, `pdk1`, or random — **copy whatever Mailgun shows**) | `k=rsa; p=MIIBIjANBg…` (long 2048-bit key) | **Yes** |
| 3 | CNAME | `email.mail` | `mailgun.org` | No (open/click tracking) |
| 4 | MX | `mail` priority 10 | `mxa.mailgun.org` | No (inbound bounce handling) |
| 5 | MX | `mail` priority 10 | `mxb.mailgun.org` | No |

### Google Workspace conflict analysis
The apex already has Google Workspace MX records. All five records above are scoped to the `mail.` subdomain — **none of them touch the apex SPF, DKIM, or MX**. Workspace mail flow to `@explainanything.com` is unaffected. Safe.

### SPF inheritance
- **Subdomains do NOT inherit apex SPF** (RFC 7208). `mail.explainanything.com` needs its own TXT record (#1 above).
- Apex SPF (`v=spf1 include:_spf.google.com ~all`) stays untouched.
- Do not merge `include:mailgun.org` into the apex — only needed if we ever send `From: someone@explainanything.com` via Mailgun (we won't; sender will be `noreply@mail.explainanything.com`).
- **One SPF TXT per host is the rule** — two SPF strings on the same host = PermError = 100% mail rejection.

### Verification timeline
- Cloudflare / Route53: typically 5–30 min.
- Slow registrars (GoDaddy classic, some shared hosts): up to 24–48h.
- Mailgun dashboard has a "Verify DNS settings" button to re-poll on demand.
- If still unverified after 24h: (a) `dig TXT mail.explainanything.com` and `dig TXT pic._domainkey.mail.explainanything.com` from terminal — values must match exactly; (b) check for wrapping-quote mangling on the DKIM record; (c) confirm no duplicate SPF; (d) Mailgun support ticket (Free tier = ticket-only, 24–48h response).

### SMTP credentials
- Dashboard nav: **Send → Sending → Domain settings → SMTP credentials tab**, with `mail.explainanything.com` selected in the top-right dropdown.
- Default username (auto-created with the domain): `postmaster@mail.explainanything.com`. **This is the literal username — full email-style string with `@domain`.**
- Password is shown ONCE at creation. If missed, "Reset password" generates a new one (shown in a toast, never again). Store in a password manager immediately.
- SMTP host: `smtp.mailgun.org`, port `587` (STARTTLS preferred over 465 implicit TLS — Supabase's Go mailer prefers STARTTLS).

### Free tier gotchas
- **100 emails/day hard cap**. Resets at UTC midnight. Overage = 4xx until reset.
- **1-day log retention**. Mailgun's log UI only shows the last 24h. Mitigate by logging `message-id` + Mailgun response in app DB if we need post-hoc debugging.
- **Authorized Recipients sandbox**: always applies to the Mailgun sandbox domain; applies to the custom domain too if no credit card on file. Adding a CC (no charge) lifts this on the custom domain.
- Upgrade path: **Foundation $35/mo** = 50k/mo, 5-day logs, multiple domains. In-place from the billing page, no re-verification.

### Reputation / warm-up
- New subdomain has zero reputation. Ramp gradually: ~20–50 emails/day in week 1, double weekly toward target volume.
- Use a stable `From: "ExplainAnything" <noreply@mail.explainanything.com>` — consistent display name + local-part helps reputation.
- Consider adding a DMARC record at apex once stable: `_dmarc.explainanything.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@explainanything.com"` (start `p=none` for monitoring; the policy at apex covers subdomain alignment for both Google and Mailgun).
- For bulk mail include `List-Unsubscribe` header (Gmail/Yahoo bulk-sender rules, enforced since 2024). Not relevant for transactional recovery emails today.

## Supabase prod project SMTP wiring
Researched 2026-05-25 via Supabase docs (auth/auth-smtp, rate-limits, email-templates, redirect-urls), Mailgun-specific Supabase discussion #7444, and Supabase's production checklist.

### Dashboard navigation (current URL patterns for prod = `qbxhivoezkfbjbsctdzo`)
- SMTP config: `https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo/auth/smtp` (Authentication → Emails → SMTP Settings — moved to its own sub-tab in 2024; some old guides point at Email Templates page)
- Rate limits: `…/auth/rate-limits`
- Email templates: `…/auth/templates`
- Site URL + Redirect allowlist: `…/auth/url-configuration`
- Toggle "Enable Custom SMTP" at the top of the SMTP page to reveal credential fields.

### Form fields with Mailgun values
| Field | API name | Mailgun value | Notes |
|---|---|---|---|
| Sender email | `smtp_admin_email` | `noreply@mail.explainanything.com` | Must be on the exact verified Mailgun domain. Cannot use `noreply@explainanything.com` unless the apex itself is separately added and verified at Mailgun. |
| Sender name | `smtp_sender_name` | `ExplainAnything` | Optional but recommended. |
| Host | `smtp_host` | `smtp.mailgun.org` | US region. (`smtp.eu.mailgun.org` if we'd picked EU.) |
| Port number | `smtp_port` | `587` | STARTTLS. Port 465 (implicit TLS) works but Supabase prefers 587. Port 25 is ISP-blocked → `i/o timeout`. |
| Username | `smtp_user` | `postmaster@mail.explainanything.com` | **Common bug**: people swap Username and Sender email. They CAN be the same (both `postmaster@…`) but they're distinct fields. |
| Password | `smtp_pass` | (from Mailgun SMTP credentials tab) | Write-only field. |

### Rate limits
- After enabling custom SMTP, Supabase defaults to **30 emails/hour** to protect provider reputation. Bump at `…/auth/rate-limits` → "Rate limit for sending emails".
- Recommended starting value: **100/hr** for prod. Raise after monitoring Mailgun deliverability for a week.
- The `email_sent = 2` in our local `supabase/config.toml` is local-dev only; it does NOT push to prod.

### Email template — the painful gotcha
- **Repo `supabase/templates/recovery.html` is NOT auto-synced to the hosted prod project.** The `[auth.email.template.recovery]` block in `supabase/config.toml` only applies when running `supabase start` locally.
- To update prod: paste manually at `…/auth/templates` → **Reset Password** → paste HTML body verbatim → Save.
- Repo template already targets `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password` — correct for the PKCE/`/auth/confirm` flow PR #1090 wires up. **Critical**: Supabase's default template uses the legacy hash flow (`/#access_token=…`) which won't work with our route. Pasting our custom template is non-negotiable.
- Alternative: push via Management API (`PATCH https://api.supabase.com/v1/projects/qbxhivoezkfbjbsctdzo/config/auth` with `mailer_templates_recovery_content`). Same end state.

### Redirect URL allowlist
- At `…/auth/url-configuration`:
  - **Site URL** → `https://explainanything.com` (or whatever the canonical prod origin is)
  - **Additional Redirect URLs** → add `https://explainanything.com/auth/confirm`
- **If missing**: the email link "works" (token validates), but Supabase redirects the user to Site URL with `error=invalid_request` and the password-reset flow silently breaks. This is the single most common cause of "the email went out but the link doesn't work" reports.
- Note: the planning doc for PR #1090 already listed this as a runbook item — confirm it was actually done.

### Testing
- **No built-in "Send test email" button** in the SMTP page as of May 2026.
- Fastest E2E: open prod site → "Forgot password" → submit a real address → check inbox + Mailgun **Sending → Logs** for the delivery event.
- Mailgun logs show `delivered` / `failed` with full SMTP response — that's the authoritative signal. If Mailgun log is empty, cross-check Supabase auth logs at `…/logs/auth-logs` for `mailer` errors.

### Common pitfalls (encountered repeatedly by other teams per Supabase discussion #7444)
1. Swapping **Username** and **Sender email** fields.
2. Using apex `@explainanything.com` when only `mail.` subdomain is verified.
3. Forgetting to add the redirect URL — silent failure.
4. Not updating the recovery template in dashboard (default = hash flow, ours = PKCE).
5. Hitting the 30/hr default cap during load testing and assuming SMTP is broken.
6. Region mismatch (using `smtp.mailgun.org` for an EU-region Mailgun domain).
7. Using port 25 (ISP-blocked).

### Plan tier
- Custom SMTP is available on the **Free Supabase tier** as of 2026 (not gated to Pro).
- Built-in (no-SMTP) sender is capped at 2 emails/hr on every plan — that's why custom SMTP is mandatory in practice.

## Repo audit — what changes (spoiler: almost nothing)
Comprehensive grep for email-sender hardcoding, SMTP env vars, CI config touch-points.

### Email templates in repo
- `supabase/templates/recovery.html` — the only template. Already points at the correct `/auth/confirm` callback. **Local-dev only**; needs manual paste into hosted prod dashboard.
- No templates for signup confirmation, magic_link, email_change, or invite in repo. Hosted prod will fall back to Supabase defaults for those flows. **None of those flows are user-triggered in the app today**, so this is fine; revisit if/when we enable email confirmation on signup.

### App code that triggers auth emails
Only one production trigger:
- `src/app/login/actions.ts:183` — `supabase.auth.resetPasswordForEmail(email, { redirectTo })` (the new server action from PR #1090).

Other auth methods (`signUp` at line 111, `updateUser` in form, `admin.generateLink` in tests) either don't trigger email or are test-only.

### Hardcoded sender addresses
**Zero matches** in src/ for `noreply@`, sender addresses, or from-name strings. Sender is entirely dashboard-configured. No code changes when sender changes.

### SMTP / provider env vars
**Zero matches** in `.env*` files, source code, or CI configs for `SMTP_*`, `MAILGUN_*`, `SENDGRID_*`, `RESEND_*`. Expected — Supabase SMTP is dashboard-managed, not env-driven from the app side.

### CI / deployment configs
Six workflows reviewed (`ci.yml`, `e2e-nightly.yml`, `post-deploy-smoke.yml`, etc.) + `vercel.json`. **No SMTP credentials needed anywhere in CI** — Mailgun creds live in the Supabase dashboard, not in the app deploy.

### Docs that need updating after Mailgun goes live
- `docs/feature_deep_dives/authentication_rls.md` — currently has no section on password recovery. Should add: recovery flow overview, template config location, Mailgun SMTP setup pointer.
- `docs/docs_overall/environments.md` — could note the per-project SMTP config location for future reference.
- `docs/planning/forgot_password_email_doesnt_work_explain_anythig_20260524/…_planning.md` — has a runbook stub for "configure Mailgun in prod dashboard"; that section is now superseded by this planning doc; cross-link.

### Tests
- `src/__tests__/integration/password-reset.integration.test.ts` — validates the Supabase SDK contract via `verifyOtp({token_hash})` directly. Doesn't touch SMTP. No changes needed.
- `src/__tests__/e2e/specs/01-auth/password-reset.spec.ts` — uses `admin.generateLink` so it never sends a real email. No changes needed.

## Sources
- Supabase: [Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- Mailgun: [Free plan details](https://help.mailgun.com/hc/en-us/articles/203068914), [Authorized Recipients](https://help.mailgun.com/hc/en-us/articles/217531258), [Domain Verification Setup Guide](https://help.mailgun.com/hc/en-us/articles/32884700912923), [DNS FAQ](https://help.mailgun.com/hc/en-us/articles/360011565514), [Region permanence](https://help.mailgun.com/hc/en-us/articles/360007512013), [SMTP credentials location](https://help.mailgun.com/hc/en-us/articles/203380100), [Send via SMTP](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp)
- Community: [Supabase × Mailgun discussion #7444](https://github.com/orgs/supabase/discussions/7444), [Best SMTP Providers for Supabase 2026](https://www.pingram.io/blog/best-smtp-providers-for-supabase)
