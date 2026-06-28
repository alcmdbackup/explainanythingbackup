// Phase 4 of build_website_for_evolutiOn_20260626 — shared redaction helper
// for the public /edit surface. Mirrors the logic embedded in
// sentry.server.config.ts beforeSend so both bootstrap files apply the same
// predicate AND a unit test can exercise it without booting Sentry.
//
// Predicate: redact any event payload that mentions `articleText` (the POST
// field name from src/app/edit/EditForm.tsx). The textarea contents could be
// an API key, PII, or otherwise sensitive content; we always replace the
// body with a sentinel string before shipping to Sentry.

import type { ErrorEvent } from '@sentry/core';

export const EDIT_REDACTION_SENTINEL = '[redacted: edit submission body]';

/**
 * Pure helper that walks a Sentry ErrorEvent and replaces any request body or
 * breadcrumb body that references articleText with the sentinel. Defensive on
 * shape — never throws. Returns the same object (mutates in place) for ease
 * of use inside beforeSend.
 */
export function redactEditPayload(event: ErrorEvent): ErrorEvent {
  try {
    const body = event.request?.data;
    if (typeof body === 'string' && body.includes('articleText')) {
      event.request = { ...event.request, data: EDIT_REDACTION_SENTINEL };
    } else if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'articleText')) {
      event.request = { ...event.request, data: EDIT_REDACTION_SENTINEL };
    }
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((bc) => {
        const bcBody = bc.data?.body;
        if (typeof bcBody === 'string' && bcBody.includes('articleText')) {
          return { ...bc, data: { ...bc.data, body: EDIT_REDACTION_SENTINEL } };
        }
        return bc;
      });
    }
    if (event.extra && typeof event.extra === 'object') {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(event.extra)) {
        if (k === 'articleText') {
          next[k] = EDIT_REDACTION_SENTINEL;
        } else {
          next[k] = v;
        }
      }
      event.extra = next;
    }
  } catch {
    // Defensive: never let the redaction itself crash beforeSend.
  }
  return event;
}
