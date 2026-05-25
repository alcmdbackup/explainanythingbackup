# Mailgun SMTP for Prod Password Email — Plan

## Background
PR #1090 wired the password-recovery flow end-to-end in code (forgot-password page, reset-password page, /auth/confirm recovery routing, triple gate, full test coverage). It deliberately deferred the SMTP question: real users currently get recovery emails from Supabase's default sender (`noreply@mail.app.supabase.io`), capped at ~2 emails/hr per project and frequently flagged as spam. That makes the just-shipped flow demonstrable on staging but unreliable on prod.

## Problem
Today's prod (`qbxhivoezkfbjbsctdzo`) has no custom SMTP configured. Two concrete consequences:
1. **Hard rate cap**: ≥3 recovery requests in the same hour silently drop on the 3rd+. User gets the success message (per email-enumeration-prevention design), no email arrives, no way to recover. Same applies to any other auth email (signup confirmation, magic link) we enable later.
2. **Deliverability**: sender domain `mail.app.supabase.io` is shared infrastructure with low reputation; even within-cap sends frequently land in spam/promotions for Gmail recipients.

## Pre-requisites — DO NOT START WITHOUT THESE
Confirm all before Phase 0. Time to acquire access (1–2 days for the harder ones) is the dominant cost of this work.

| # | What | Who/where |
|---|---|---|
| 1 | Mailgun account creation rights (no existing account assumed) | Whoever owns billing for explainanything.com |
| 2 | DNS write access to `explainanything.com` | Registrar/DNS provider — **figure out before starting** which registrar holds this domain (Cloudflare? Route53? Namecheap? GoDaddy?). DNS speed varies 30× across providers (5 min on Cloudflare vs 24h+ on GoDaddy classic). |
| 3 | Supabase Owner or Admin role on `qbxhivoezkfbjbsctdzo` (prod project) | Confirm at https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo/settings/team |
| 4 | Vercel project Admin role (only needed if rolling back deploys after a bad config) | https://vercel.com/dashboard |
| 5 | A company credit card you can attach to Mailgun | **No charge unless free-tier limit exceeded** — but Mailgun requires it on file to lift the "5 authorized recipients" restriction on custom domains. If you can't add one, escalate to whoever can; CC-on-file is non-negotiable for production. |
| 6 | An SMS-capable phone number for Mailgun verification | Personal mobile is fine; voice fallback exists if SMS fails. |
| 7 | **Test inboxes on multiple providers** for verification — at least one Gmail, one iCloud or Outlook | **Do not** use your `@explainanything.com` (Google Workspace) address as the only test inbox: same-domain MX overlap can mask deliverability issues. |
| 8 | This planning doc + `_research.md` open in another tab | Several values to copy between contexts. |

Estimated total wall-clock: **~90 min hands-on + 30 min–48h DNS propagation wait** depending on registrar.

## Decision summary
| # | Decision | Rationale |
|---|---|---|
| 1 | **Provider: Mailgun** | Battle-tested, simple SMTP, generous free tier covers current volume. |
| 2 | **Sending domain: `mail.explainanything.com`** (subdomain) | Isolates Mailgun reputation from apex's Google Workspace; SPF/DKIM scoped to subdomain, no apex impact. |
| 3 | **Region: US** | US-based team. Region is permanent per Mailgun domain — locking it now. |
| 4 | **Plan: Free tier + credit card on file** | 100/day cap is well above current volume. CC (no charge) lifts the sandbox "5 authorized recipients" restriction. |
| 5 | **Prod-only Mailgun**; staging stays on Supabase default | Free tier = 1 custom domain. Prod is where real users hit the flow. Staging's only consumer is manual checkpoint testing, which works fine on the rate-limited default sender. **Adding staging later is trivial — create `mail-staging.explainanything.com` in the same Mailgun account if/when we move to Foundation ($35/mo, multi-domain).** |
| 6 | **No code changes** | Repo audit (see `_research.md`) confirms zero hardcoded senders, zero SMTP env vars, no CI touch-points. All config lives in dashboards and DNS. |
| 7 | **Prod site URL = `https://explainanything.vercel.app`** | Per `docs/docs_overall/environments.md`. This is what goes in Supabase's Site URL field; redirect allowlist needs `https://explainanything.vercel.app/auth/confirm`. (Apex domain `explainanything.com` is owned for email-sending only — the public site lives at the Vercel hostname.) |
| 8 | **Staging Supabase (`ifubinffdbyewoezcidz`) is NOT touched by this work.** Supabase projects are fully isolated — this change has zero effect on staging code paths, staging users, or staging auth emails. |

## Glossary (one-liners for non-DNS-native readers)
- **TXT record**: free-form text DNS record. Used by SPF, DKIM, DMARC, domain verification.
- **MX record**: where mail FOR this domain should be delivered. Has nothing to do with sending; only inbound.
- **CNAME**: alias pointing one DNS name at another.
- **SPF** (Sender Policy Framework): TXT record listing who's allowed to send mail claiming to be from this domain. Receivers check it.
- **DKIM** (DomainKeys Identified Mail): cryptographic signature on outbound mail; the public key is published in DNS. Receivers verify mail wasn't tampered with.
- **DMARC**: policy on top of SPF+DKIM saying "what to do with mail that fails". Optional but increasingly expected.
- **STARTTLS / Implicit TLS**: two ways SMTP can be encrypted. STARTTLS = plain connect, upgrade to TLS (port 587). Implicit TLS = TLS from the start (port 465). Both safe; just two flavors.
- **PKCE flow**: Supabase's modern token-hash-in-query password-recovery flow (used by our `/auth/confirm` route). Legacy alternative is "hash flow" with `#access_token=…` in URL fragment — won't work with our route.
- **PermError**: hard SPF/DMARC failure due to config error (e.g., two `v=spf1` records). Means 100% of mail rejected.
- **Authorized Recipients (Mailgun)**: sandbox restriction limiting outgoing mail to 5 pre-approved addresses. Applies to sandbox domain always; to custom domains if no CC on file.

## Phased Execution Plan

Phases run sequentially, but **Phase 3 sub-steps that DON'T need SMTP credentials (template paste, redirect-allowlist verify) CAN be done in parallel during Phase 2's DNS-propagation wait**. Use that window — don't twiddle thumbs.

---

### Phase 0: Sanity-check what PR #1090 left behind ⏱ ~5 min
**Why this exists first**: PR #1090's planning doc listed "add `https://<prod-site>/auth/confirm` to redirect allowlist" as a manual runbook item. If it was skipped, recovery has been **silently broken in prod since PR #1090 merged** — independent of SMTP. Find out before sinking 90 min into Mailgun.

- [ ] Open `https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo/auth/url-configuration`.
- [ ] Confirm **Site URL** = `https://explainanything.vercel.app`. (If different, note the actual value — that's the canonical for the rest of this doc.)
- [ ] Confirm **Additional Redirect URLs** includes `https://explainanything.vercel.app/auth/confirm`.
  - **If missing**: add it RIGHT NOW (single field, one save). This is independently load-bearing; without it the email-link click silently fails even with perfect SMTP. Don't wait for the full Mailgun setup.
- [ ] Open `https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo/auth/templates` → select **Reset Password** → does the template body match `supabase/templates/recovery.html`?
  - **If it's still the default Supabase template** (uses `{{ .ConfirmationURL }}` with `#access_token=…` hash flow): paste our repo template now. Same urgency as above — recovery flow is broken until this is done.
  - **If it matches the repo**: ✓ noted, proceed.

**Success criterion for Phase 0**: both fields are correct in the dashboard, and a manual reset attempt with the default Supabase sender now lands on `/reset-password` form correctly. (If it doesn't, Mailgun won't fix that — it's a redirect/template problem.)

---

### Phase 1: Mailgun account + sending domain ⏱ ~15 min interactive
- [ ] Sign up at https://signup.mailgun.com/new/signup?plan_name=flex_free (Flex Free, no-CC variant).
  - **Success**: account dashboard loads at `app.mailgun.com`.
- [ ] Complete SMS verification.
  - **Fallback**: if SMS doesn't arrive in 5 min, request voice call (option on the verify screen). If both fail, open a support ticket at support@mailgun.com — Free tier response 24–48h.
- [ ] **Add a credit card** at Billing → Plans & Billing → Payment Method.
  - **Success**: domain page no longer shows the "Authorized Recipients" tab (or the tab is empty and not enforced).
  - **No charge unless monthly usage exceeds free tier** (100/day = ~3000/mo max; you'll be 1% of that).
  - **Fallback**: if CC declined, contact Mailgun support; in the meantime add up to 5 authorized recipients (Domain Settings → Authorized Recipients) for testing — sufficient for Phase 4 but breaks for arbitrary real users.
- [ ] **Send → Sending → Domains → Add new domain**:
  - Domain: `mail.explainanything.com`
  - Region: **US** (permanent per domain — verify before clicking Create)
  - DKIM key length: **2048**
  - Leave "Create DKIM Authority" as the subdomain itself.
  - **Success**: page transitions to "DNS records" view showing 5 records to add.
- [ ] On the DNS-records page, click **"SMTP credentials"** tab.
  - Default username: `postmaster@mail.explainanything.com`.
  - Click **"Reset password"** (or click the username if password isn't pre-shown). **A password appears once in a bottom-right toast — Mailgun WILL NOT show it again.**

🚨 **CRITICAL — DO NOT LOSE THIS PASSWORD**:
1. Copy it to your password manager immediately.
2. **Keep the Mailgun tab open** until Phase 3 finishes — you'll paste this password into Supabase in ~10 min.
3. If lost, you must reset — old password becomes invalid the moment a new one is generated.

---

### Phase 2: DNS records at registrar ⏱ ~10 min interactive + 5 min–48h propagation
All hosts shown relative to apex `explainanything.com`. **Apex Google Workspace MX records are NOT affected** (these are subdomain-scoped).

#### Required for sending (2 records — skip the rest if you only want recovery email to work)
- [ ] **TXT** at host `mail` → value `v=spf1 include:mailgun.org ~all` (SPF — authorizes Mailgun to send for this subdomain)
- [ ] **TXT** at host `<selector>._domainkey.mail` → value `k=rsa; p=MIIBIjANBg…` (long DKIM public key, 2048-bit)
  - 🚨 **Copy the `<selector>` (e.g. `pic`, `k1`, or random) and the full key value EXACTLY from the Mailgun dashboard** — don't type, copy-paste. Common bug: DNS UI mangles long TXT values by adding wrapping quotes; if so, split into 255-char chunks per the registrar's syntax.

#### Optional records (only useful if you want bounce handling later — skip for transactional-only)
- [ ] **MX** at `mail` priority 10 → `mxa.mailgun.org`
- [ ] **MX** at `mail` priority 10 → `mxb.mailgun.org`
- [ ] **CNAME** at `email.mail` → `mailgun.org` (open/click tracking — not useful for password-reset)

#### Verify
- [ ] In Mailgun dashboard click **"Verify DNS settings"**.
  - **Success**: SPF and DKIM rows show green checks. CNAME/MX may show yellow/red if you skipped them — that's fine, they're optional.
  - **Realistic timeline**: Cloudflare/Route53 = 5–30 min. Slow registrars = up to 48h. Hit Verify every few minutes — it's just a re-check, no penalty.

#### If verification stalls past expected window:
From a terminal:
```bash
dig TXT mail.explainanything.com +short
dig TXT <selector>._domainkey.mail.explainanything.com +short
```
- **Expected output for SPF**: a single line `"v=spf1 include:mailgun.org ~all"` (with quotes — those are dig's, not part of the value).
- **Expected output for DKIM**: one or more quoted chunks; concatenate them and they should match the Mailgun-shown value (minus dig's wrapping quotes).
- **Common causes when values don't match**: registrar UI added wrapping quotes; record was added at wrong host (e.g., `mail.explainanything.com.mail` because UI auto-appended apex); duplicate SPF (two `v=spf1` records = PermError = 100% mail rejection).

---

### Phase 3: Supabase PROD project SMTP config ⏱ ~10 min interactive
URLs: replace `<ref>` with `qbxhivoezkfbjbsctdzo` (prod).

**Parallelism note**: sub-steps 3 (template paste) and 4 (redirect allowlist verify) don't depend on Mailgun credentials. You can do them during Phase 2's DNS propagation wait. Sub-steps 1 (SMTP form) and 2 (rate limit) need Phase 2 verified first — Supabase tests the SMTP connection on Save and the first email send will hard-fail without DNS.

#### Sub-step 1: SMTP form (blocked by Phase 2 verification)
- [ ] Navigate to `https://supabase.com/dashboard/project/<ref>/auth/smtp`. Toggle **Enable Custom SMTP** on. Fill:
  - **Sender email**: `noreply@mail.explainanything.com`
    - 🚨 **MUST be on the verified Mailgun domain (`mail.` subdomain).** If you type `noreply@explainanything.com` (apex), saves succeed silently but Mailgun rejects the send with `550 sender not allowed` — user-visible symptom is "email never arrives, no error anywhere in Supabase".
  - **Sender name**: `ExplainAnything`
  - **Host**: `smtp.mailgun.org`
  - **Port**: `587` (STARTTLS — not 465, not 25)
  - **Username**: `postmaster@mail.explainanything.com` (literal — full email string with `@domain`)
  - **Password**: from Phase 1 (the toast value you put in your password manager)
  - Save.
  - **Success**: Supabase tests the SMTP connection on save and shows ✓ or surfaces an error inline. If error: most likely wrong port, wrong username (Mailgun common bug = swapping Username and Sender email), or wrong password (regen in Mailgun).

#### Sub-step 2: Rate limit (blocked by sub-step 1)
- [ ] Navigate to `https://supabase.com/dashboard/project/<ref>/auth/rate-limits` → "Rate limit for sending emails" → bump from default **30/hr** to **100/hr**.
  - **Success**: page shows the new value after save.
  - **Why bump**: 30/hr default is conservative; 100/hr covers any realistic recovery-email burst. Leave other categories at defaults.

#### Sub-step 3: Email template (can do during Phase 2 wait)
- [ ] Navigate to `https://supabase.com/dashboard/project/<ref>/auth/templates` → **Reset Password** tab.
- [ ] Open `supabase/templates/recovery.html` in your editor.
- [ ] Replace the entire dashboard template body with the repo file's contents → Save.
- 🚨 **Why**: Supabase's default template uses `{{ .ConfirmationURL }}` which expands to a URL with `#access_token=…` (legacy hash flow). Our `/auth/confirm` route expects `?token_hash=…` (PKCE flow). Wrong template = email arrives, link clicks, page silently fails to enable the form.

#### Sub-step 4: Redirect allowlist (can do during Phase 2 wait — also done in Phase 0)
- [ ] Re-confirm what you set in Phase 0 is still there.

---

### Phase 4: Multi-provider verification ⏱ ~10 min hands-on + 24h optional monitoring
Single-provider verification masks reputation issues. Test across providers.

- [ ] Mail-tester.com baseline:
  - Go to https://www.mail-tester.com — get a one-time `test-XXXX@srv1.mail-tester.com` address.
  - On prod (`https://explainanything.vercel.app`), hit `/forgot-password`, submit that test address.
  - Wait ~30 sec, hit "Then check your score" on mail-tester.
  - **Success**: score ≥ 8/10. SPF, DKIM should both be green. Lower than 8 = read the breakdown and fix what's flagged before user testing.
- [ ] Per-provider inbox test (3 separate runs):
  - Submit `/forgot-password` with your **Gmail** test address. Confirm email arrives in Inbox (not Spam) within 1 min. Note sender: should display as "ExplainAnything <noreply@mail.explainanything.com>".
  - Repeat with **iCloud** test address.
  - Repeat with **Outlook/Hotmail** test address.
  - **For any provider where the email lands in Spam**: hit "Not spam" / "Move to Inbox" — that helps reputation. Note the provider; may want a slower warm-up (Phase 6) if all three flag.
- [ ] Click the reset link from one of the test emails.
  - **Expected flow**: lands on `/auth/confirm?token_hash=…&type=recovery&next=/reset-password` → redirects to `/reset-password?token_hash=…&type=recovery` → form enables → submit new password → lands at `/` authenticated.
  - **Use a throwaway test user** for this — the user's password actually gets changed.
- [ ] Cross-check **Mailgun → Sending → Logs** for the message. Should show `delivered` with full SMTP response.
- [ ] Cross-check **Supabase → Logs → Auth Logs** at `…/logs/auth-logs` for any `mailer` errors (should be none).

#### Rollback if Phase 4 fails after >15 min troubleshooting:
- **Disable Custom SMTP toggle** at `…/auth/smtp` — instantly reverts to Supabase default sender. Recovery flow goes back to the rate-limited, low-deliverability baseline but at least works.
- No data loss; no user-visible regression beyond the rate cap.
- Then investigate calmly: typically wrong username/password, wrong sender email domain, or DNS still propagating.

---

### Phase 5: Documentation updates ⏱ ~20 min
- [ ] `docs/feature_deep_dives/authentication_rls.md` — add a "Password reset flow" section. Suggested structure:
  - **Entry point**: `/forgot-password` page, `requestPasswordReset` server action (`src/app/login/actions.ts:148`).
  - **Email delivery**: now via Mailgun SMTP on `mail.explainanything.com` (free tier, US region). Sender: `noreply@mail.explainanything.com`. Config at Supabase dashboard `…/auth/smtp` — not env-driven.
  - **Callback**: `/auth/confirm` route forwards recovery tokens to `/reset-password` for client-side `verifyOtp` (needed for PASSWORD_RECOVERY event). See PR #1090.
  - **Form**: triple gate — server `getUser()` vs `GUEST_USER_ID`, client PASSWORD_RECOVERY event, client `useIsGuest()`.
  - **Cross-link**: this planning doc and `forgot_password_email_doesnt_work_explain_anythig_20260524/_planning.md`.
- [ ] `docs/docs_overall/environments.md` — under the prod Supabase project section, note: "Custom SMTP via Mailgun (`mail.explainanything.com`, US region). Credentials in Mailgun dashboard; SMTP config at `dashboard.supabase.com/project/qbxhivoezkfbjbsctdzo/auth/smtp`."
- [ ] Cross-link from `docs/planning/forgot_password_email_doesnt_work_explain_anythig_20260524/_planning.md` runbook section (Mailgun stub) → this planning doc.

---

### Phase 6: Monitoring (passive, not blocking merge) ⏱ ongoing
Real recovery-email volume will be tiny (~5–20/day in current product state). Traditional bulk-sender warm-up (e.g., "double daily volume weekly") is theatre at this scale — there's nothing to ramp.

What's actually worth doing:
- [ ] **Weekly check** of Mailgun → Sending → Logs for bounce rate. Transactional recovery should be near-zero bounces. Spike = bad sender reputation or DNS regression.
- [ ] **Optional DMARC** at apex: `_dmarc.explainanything.com` TXT `"v=DMARC1; p=none; rua=mailto:dmarc@explainanything.com"`. Starts in monitor mode (`p=none`); covers both Google Workspace apex mail and Mailgun subdomain. Worth it if you ever do bulk mail or want reporting; skippable for transactional-only.
- [ ] Upgrade trigger: if sustained daily volume approaches 30 (well before hitting the 100/day cliff), upgrade to Foundation ($35/mo, 50k/mo, 5-day logs, multi-domain).

---

## Adding or rotating SMTP credentials (reference)
Credentials live in Supabase's project-level auth config, NOT in app env vars, GitHub Secrets, or Vercel. Nothing in `src/`, `.env*`, `.github/workflows/`, or `vercel.json` references them.

**Add for the first time**: Phase 3 sub-step 1 (dashboard UI) — recommended. ~2 min.

**Rotate after Mailgun regen** (e.g., if the password is compromised or you intentionally regenerate):
1. In Mailgun → **Send → Sending → Domain settings → SMTP credentials**, click the `postmaster@mail.explainanything.com` user → **Reset password** → new password appears once in a toast.
2. Update Supabase via either path:

**Path A — Dashboard** (same as initial setup):
- `https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo/auth/smtp` → paste new password into the Password field → Save.

**Path B — Management API** (scriptable; useful if you ever IaC this):
```bash
curl -X PATCH "https://api.supabase.com/v1/projects/qbxhivoezkfbjbsctdzo/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "smtp_admin_email": "noreply@mail.explainanything.com",
    "smtp_sender_name": "ExplainAnything",
    "smtp_host": "smtp.mailgun.org",
    "smtp_port": 587,
    "smtp_user": "postmaster@mail.explainanything.com",
    "smtp_pass": "<new-mailgun-password>"
  }'
```
`$SUPABASE_ACCESS_TOKEN` is a personal access token from `https://supabase.com/dashboard/account/tokens` (same token works for any project ref you have access to; one already exists as a GitHub Secret named `SUPABASE_ACCESS_TOKEN` for CI use).

**What you do NOT need to do during add or rotation:**
- ❌ Touch `.env.local` / `.env.example`
- ❌ Add to GitHub Actions secrets (none of CI uses SMTP)
- ❌ Add to Vercel environment variables
- ❌ Update CI workflows
- ❌ Redeploy the app — config takes effect on Supabase's side immediately

The app calls `supabase.auth.resetPasswordForEmail(...)`; Supabase's API decides which SMTP to send through based on the project's config. Credentials never traverse the app process. Rotation is a Supabase-side change only.

## What's NOT in this plan
- **Staging Mailgun setup** — out of scope; staging stays on Supabase default. See decision #5 for follow-up path.
- **Other email templates** (signup confirmation, magic link, email change, invite) — not currently triggered by user-facing app code per repo audit. Add when those flows ship.
- **Code changes** — none. Sender is dashboard-configured. App is provider-agnostic.

## Risks
| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Free tier 100/day cap hit during real user traffic | Low (current volume is single-digit/day) | Monitor weekly per Phase 6; upgrade to Foundation when sustained daily volume approaches 30. |
| 2 | DKIM record gets mangled by DNS UI quote-handling | Medium | Phase 2 verify step + explicit `dig` instructions. |
| 3 | Sender domain reputation builds slowly; first emails land in spam | Medium | Multi-provider test in Phase 4 + Phase 6 monitoring. Educate first test users to flag "not spam". |
| 4 | Phase 0 surfaces that PR #1090's runbook was never followed → prod recovery currently broken | High **if true** | Phase 0 explicitly checks; fix in minutes if so (single field in Supabase dashboard). |
| 5 | Wrong Sender email (apex vs subdomain) → silent `550` rejection with no Supabase error | Medium | Phase 3 sub-step 1 has 🚨 callout. |
| 6 | Recovery template not pasted into prod → email link silently lands on wrong page | High | Phase 0 + Phase 3 sub-step 3 both check. |
| 7 | Custom SMTP enabled with wrong creds → ALL Supabase auth email silently fails, no fallback to default | High | Rollback line in Phase 4: disable toggle = instant revert. |
| 8 | 1-day Mailgun log retention on free tier → can't debug user reports >24h old | Accepted limitation | If this becomes painful, upgrade to Foundation (5-day retention) or add app-side logging of message-id + provider response. |
| 9 | SMTP password leaked or rotated externally → re-enter in Supabase | Low | Mailgun "Reset password" button generates new one; update Supabase SMTP form. |

## Tracked docs
- `docs/feature_deep_dives/authentication_rls.md` (Phase 5)
- `docs/docs_overall/environments.md` (Phase 5)
- `docs/planning/forgot_password_email_doesnt_work_explain_anythig_20260524/forgot_password_email_doesnt_work_explain_anythig_20260524_planning.md` (cross-link, Phase 5)
