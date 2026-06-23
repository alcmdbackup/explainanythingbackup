// Style fingerprint detail page: Overview (traits + prose + re-extract), Articles
// (add/remove/reorder → recompute), Runs (referencing this fingerprint), Metrics.

import { StyleFingerprintDetailContent } from './StyleFingerprintDetailContent';

export default async function StyleFingerprintDetailPage(
  { params }: { params: Promise<{ styleFingerprintId: string }> },
): Promise<JSX.Element> {
  const { styleFingerprintId } = await params;
  return <StyleFingerprintDetailContent fingerprintId={styleFingerprintId} />;
}
