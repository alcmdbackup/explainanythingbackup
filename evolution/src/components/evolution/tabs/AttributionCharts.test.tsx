// Unit test for AttributionCharts: verifies the abortableEffectController unmount-guard
// prevents setState-after-unmount warnings during chained navigation.

import React from 'react';
import { render } from '@testing-library/react';
import { AttributionCharts } from './AttributionCharts';

jest.mock('@evolution/services/metricsActions', () => ({
  getEntityMetricsAction: jest.fn(),
}));

const { getEntityMetricsAction } = jest.requireMock('@evolution/services/metricsActions');

describe('AttributionCharts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not emit setState-after-unmount warning when unmounted mid-fetch', async () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((r) => { resolve = r; });
    getEntityMetricsAction.mockReturnValue(promise);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(
      <AttributionCharts entityType="run" entityId="00000000-0000-0000-0000-000000000001" />,
    );

    unmount();
    resolve({ success: true, data: [], error: null });
    await new Promise((r) => setTimeout(r, 0));

    const setStateWarnings = errorSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && /unmounted|update on an unmounted/i.test(a)),
    );
    expect(setStateWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });
});
