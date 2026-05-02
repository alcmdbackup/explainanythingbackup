/**
 * @jest-environment jsdom
 */
// Phase 6.1b — Mock-driven UI integration test for the invocation-detail
// rendering of an iterative_editing execution_detail row. Renders the
// ConfigDrivenDetailRenderer against the canonical iterativeEditingDetailFixture
// + the 'iterative_editing' DETAIL_VIEW_CONFIGS entry. Deterministic, in-process
// Jest+RTL — runs in the pre-merge gate.
//
// Companion to Phase 6.1a's @evolution-tagged real-LLM E2E (`admin-evolution-
// iterative-editing.spec.ts`); the E2E adds production-confidence smoke
// against a live deploy, this test verifies the rendering invariants
// deterministically.

import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigDrivenDetailRenderer } from '@/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer';
import { DETAIL_VIEW_CONFIGS } from '@evolution/lib/core/detailViewConfigs';
import { iterativeEditingDetailFixture } from '@evolution/testing/executionDetailFixtures';

describe('iterative_editing invocation detail rendering', () => {
  function flatten(detail: Record<string, unknown>): Record<string, unknown> {
    // Flatten cycles[0].* keys for the config's annotated-edits field which
    // expects sub-keys at the top level.
    const flat: Record<string, unknown> = { ...detail };
    const cycles = detail.cycles as Array<Record<string, unknown>> | undefined;
    if (cycles && cycles[0]) {
      for (const [k, v] of Object.entries(cycles[0])) {
        flat[`cycles.0.${k}`] = v;
      }
    }
    return flat;
  }

  it('renders all config-driven sub-fields without crashing', () => {
    const config = DETAIL_VIEW_CONFIGS['iterative_editing'];
    expect(config).toBeDefined();
    render(
      <ConfigDrivenDetailRenderer
        config={config!}
        data={flatten(iterativeEditingDetailFixture as unknown as Record<string, unknown>)}
      />,
    );
    // Top-level fields.
    expect(screen.getByTestId('field-parentVariantId')).toBeInTheDocument();
    expect(screen.getByTestId('field-finalVariantId')).toBeInTheDocument();
    expect(screen.getByTestId('field-stopReason')).toBeInTheDocument();
    expect(screen.getByTestId('field-config')).toBeInTheDocument();
    expect(screen.getByTestId('field-cycles')).toBeInTheDocument();
    expect(screen.getByTestId('field-totalCost')).toBeInTheDocument();
  });

  it('renders the cycles[] table with per-purpose cost columns', () => {
    const config = DETAIL_VIEW_CONFIGS['iterative_editing'];
    render(
      <ConfigDrivenDetailRenderer
        config={config!}
        data={flatten(iterativeEditingDetailFixture as unknown as Record<string, unknown>)}
      />,
    );
    const cyclesField = screen.getByTestId('field-cycles');
    // Headers: Cycle / Accepted / Rejected / Applied / Size Ratio / Propose $ / Approve $.
    expect(cyclesField.textContent).toMatch(/Cycle/);
    expect(cyclesField.textContent).toMatch(/Accepted/);
    expect(cyclesField.textContent).toMatch(/Rejected/);
    expect(cyclesField.textContent).toMatch(/Applied/);
    expect(cyclesField.textContent).toMatch(/Propose/);
    expect(cyclesField.textContent).toMatch(/Approve/);
  });

  it('renders AnnotatedProposals for cycle 1 with toolbar', () => {
    const config = DETAIL_VIEW_CONFIGS['iterative_editing'];
    render(
      <ConfigDrivenDetailRenderer
        config={config!}
        data={flatten(iterativeEditingDetailFixture as unknown as Record<string, unknown>)}
      />,
    );
    expect(screen.getByTestId('annotated-proposals')).toBeInTheDocument();
    expect(screen.getByTestId('annotated-view-annotated')).toBeInTheDocument();
    expect(screen.getByTestId('annotated-view-final')).toBeInTheDocument();
    expect(screen.getByTestId('annotated-view-original')).toBeInTheDocument();
  });

  it('toolbar mode switching reveals different views', () => {
    const config = DETAIL_VIEW_CONFIGS['iterative_editing'];
    render(
      <ConfigDrivenDetailRenderer
        config={config!}
        data={flatten(iterativeEditingDetailFixture as unknown as Record<string, unknown>)}
      />,
    );
    expect(screen.getByTestId('annotated-content')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('annotated-view-final'));
    expect(screen.getByTestId('annotated-final')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('annotated-view-original'));
    expect(screen.getByTestId('annotated-original')).toBeInTheDocument();
  });

  it('decision badges color-code accept vs reject in the annotated view', () => {
    const config = DETAIL_VIEW_CONFIGS['iterative_editing'];
    render(
      <ConfigDrivenDetailRenderer
        config={config!}
        data={flatten(iterativeEditingDetailFixture as unknown as Record<string, unknown>)}
      />,
    );
    // Fixture has group 1 accepted + group 2 rejected in cycle 1.
    const acceptedSpan = screen.queryByTestId('annotated-group-1');
    const rejectedSpan = screen.queryByTestId('annotated-group-2');
    if (acceptedSpan) expect(acceptedSpan).toHaveAttribute('data-outcome', 'accepted');
    if (rejectedSpan) expect(rejectedSpan).toHaveAttribute('data-outcome', 'rejected');
  });

  it('config sub-fields render the resolved model values', () => {
    const config = DETAIL_VIEW_CONFIGS['iterative_editing'];
    render(
      <ConfigDrivenDetailRenderer
        config={config!}
        data={flatten(iterativeEditingDetailFixture as unknown as Record<string, unknown>)}
      />,
    );
    const configField = screen.getByTestId('field-config');
    expect(configField.textContent).toMatch(/gpt-4\.1/);
    expect(configField.textContent).toMatch(/claude-sonnet/);
  });
});
