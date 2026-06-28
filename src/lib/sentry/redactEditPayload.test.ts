// Tests for the shared /edit Sentry redaction helper (Phase 4 of
// build_website_for_evolutiOn_20260626). Both sentry.server.config.ts and
// sentry.client.config.ts call this helper inside beforeSend.

import type { ErrorEvent } from '@sentry/core';
import { redactEditPayload, EDIT_REDACTION_SENTINEL } from './redactEditPayload';

function makeEvent(partial: Partial<ErrorEvent>): ErrorEvent {
  return { ...partial } as ErrorEvent;
}

describe('redactEditPayload', () => {
  it('redacts string request.data that contains articleText', () => {
    const event = makeEvent({
      request: {
        url: 'http://localhost/edit',
        data: 'articleText=A%20long%20article%20with%20a%20secret%20API%20key',
      },
    });
    const out = redactEditPayload(event);
    expect(out.request?.data).toBe(EDIT_REDACTION_SENTINEL);
  });

  it('redacts object request.data that has an articleText key', () => {
    const event = makeEvent({
      request: {
        url: 'http://localhost/edit',
        data: { articleText: 'sensitive text', strategyId: 'abc' },
      },
    });
    const out = redactEditPayload(event);
    expect(out.request?.data).toBe(EDIT_REDACTION_SENTINEL);
  });

  it('leaves request.data alone when articleText is absent', () => {
    const original = { someOther: 'value' };
    const event = makeEvent({
      request: { url: '/other', data: original },
    });
    const out = redactEditPayload(event);
    expect(out.request?.data).toBe(original);
  });

  it('redacts breadcrumb.data.body strings that contain articleText', () => {
    const event = makeEvent({
      breadcrumbs: [
        {
          category: 'fetch',
          data: { body: 'articleText=foo&strategyId=bar' },
        },
        { category: 'navigation', data: { from: '/', to: '/edit' } },
      ],
    });
    const out = redactEditPayload(event);
    expect(out.breadcrumbs?.[0]?.data?.body).toBe(EDIT_REDACTION_SENTINEL);
    // Non-articleText breadcrumb is untouched.
    expect(out.breadcrumbs?.[1]?.data?.from).toBe('/');
  });

  it('redacts event.extra.articleText specifically', () => {
    const event = makeEvent({
      extra: { articleText: 'pasted PII', strategyId: 'abc' },
    });
    const out = redactEditPayload(event);
    expect(out.extra?.articleText).toBe(EDIT_REDACTION_SENTINEL);
    expect(out.extra?.strategyId).toBe('abc');
  });

  it('does not throw on a malformed event with no request / breadcrumbs / extra', () => {
    const event = makeEvent({});
    expect(() => redactEditPayload(event)).not.toThrow();
  });

  it('does not throw on null data inside request', () => {
    const event = makeEvent({
      request: { url: '/edit', data: null as unknown as string },
    });
    expect(() => redactEditPayload(event)).not.toThrow();
  });
});
