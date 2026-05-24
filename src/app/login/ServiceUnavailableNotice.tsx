/**
 * ServiceUnavailableNotice — server component rendered by /login when the
 * GUEST_AUTOLOGIN_FAILED_RECENTLY cookie is present. Replaces the login form
 * during the 60s cookie window to avoid the redirect loop when middleware
 * auto-login is broken in prod.
 *
 * Static markup, no JavaScript needed.
 */

export function ServiceUnavailableNotice() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[var(--surface-primary)] px-4"
      data-testid="service-unavailable-notice"
    >
      <div className="max-w-md w-full rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture shadow-warm-lg p-8 text-center">
        <h1 className="font-display text-2xl text-[var(--text-primary)] mb-3">
          Service temporarily unavailable
        </h1>
        <p className="font-body text-[var(--text-secondary)]">
          We&apos;re having trouble signing you in right now. Please refresh the page in a
          moment — if the problem persists, try again in a minute.
        </p>
      </div>
    </div>
  );
}
