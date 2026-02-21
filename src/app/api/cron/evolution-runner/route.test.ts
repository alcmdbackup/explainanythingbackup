// Verify legacy cron path re-exports from unified endpoint.
// Full behavior tests live in src/app/api/evolution/run/route.test.ts.

import * as legacyCron from './route';
import * as unifiedEndpoint from '@/app/api/evolution/run/route';

describe('Legacy cron re-export', () => {
  it('GET is the same function as unified endpoint GET', () => {
    expect(legacyCron.GET).toBe(unifiedEndpoint.GET);
  });

  it('POST is the same function as unified endpoint POST', () => {
    expect(legacyCron.POST).toBe(unifiedEndpoint.POST);
  });

  it('maxDuration is the same as unified endpoint', () => {
    expect(legacyCron.maxDuration).toBe(unifiedEndpoint.maxDuration);
  });
});
