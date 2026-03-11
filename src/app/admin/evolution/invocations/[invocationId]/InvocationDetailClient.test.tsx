// Tests for InvocationDetailClient: InputVariantSection and OutputVariantsSection with collapsible bars.

import { render, screen, fireEvent } from '@testing-library/react';
import { InputVariantSection, OutputVariantsSection } from './InvocationDetailClient';

jest.mock('@evolution/components/evolution/InputArticleSection', () => ({
  InputArticleSection: () => <div data-testid="input-article">InputArticle</div>,
}));

jest.mock('@evolution/components/evolution/TextDiff', () => ({
  TextDiff: () => <div data-testid="text-diff">TextDiff</div>,
}));

const baseDiff = {
  variantId: 'aaaaaaaa-1111-2222-3333-444444444444',
  strategy: 'evolution',
  parentId: 'bbbbbbbb-1111-2222-3333-444444444444',
  beforeText: 'old text',
  afterText: 'new text',
  textMissing: false,
  eloDelta: 50,
  eloAfter: 1250,
  sigmaAfter: 4,
};

describe('InputVariantSection', () => {
  it('shows empty state when no input variant', () => {
    render(<InputVariantSection inputVariant={null} runId="run-1" />);
    expect(screen.getByText('No input variant available.')).toBeInTheDocument();
  });

  it('renders input article with CI', () => {
    render(
      <InputVariantSection
        inputVariant={{ variantId: 'v-in', strategy: 'seed', text: 'hello', textMissing: false, elo: 1300, sigma: 5 }}
        runId="run-1"
      />
    );
    expect(screen.getByTestId('input-article')).toBeInTheDocument();
    // CI: [1300 - 1.96*5*16, 1300 + 1.96*5*16] = [1143, 1457]
    expect(screen.getByText(/1143.*1457/)).toBeInTheDocument();
  });

  it('hides CI when sigma is 0', () => {
    render(
      <InputVariantSection
        inputVariant={{ variantId: 'v-in', strategy: 'seed', text: 'hello', textMissing: false, elo: 1300, sigma: 0 }}
        runId="run-1"
      />
    );
    expect(screen.queryByText(/95% CI/)).not.toBeInTheDocument();
  });
});

describe('OutputVariantsSection', () => {
  it('shows empty state when no variants', () => {
    render(<OutputVariantsSection variantDiffs={[]} eloHistory={{}} runId="run-1" />);
    expect(screen.getByText('No output variants produced.')).toBeInTheDocument();
  });

  it('renders collapsible bars for output variants', () => {
    render(<OutputVariantsSection variantDiffs={[baseDiff]} eloHistory={{}} runId="run-1" />);
    expect(screen.getByText('Output Variants (1)')).toBeInTheDocument();
    expect(screen.getByText('evolution')).toBeInTheDocument();
    // TextDiff should NOT be visible initially (collapsed)
    expect(screen.queryByTestId('text-diff')).not.toBeInTheDocument();
  });

  it('expands variant on click to show TextDiff', () => {
    render(<OutputVariantsSection variantDiffs={[baseDiff]} eloHistory={{}} runId="run-1" />);
    // Click the collapsible bar
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.getByTestId('text-diff')).toBeInTheDocument();
  });

  it('collapses variant on second click', () => {
    render(<OutputVariantsSection variantDiffs={[baseDiff]} eloHistory={{}} runId="run-1" />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.getByTestId('text-diff')).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByTestId('text-diff')).not.toBeInTheDocument();
  });

  it('shows Elo with CI in header', () => {
    render(<OutputVariantsSection variantDiffs={[baseDiff]} eloHistory={{}} runId="run-1" />);
    // Elo 1250 ±125 (1.96 * 4 * 16 ≈ 125)
    expect(screen.getByText(/1250/)).toBeInTheDocument();
    expect(screen.getByText(/±125/)).toBeInTheDocument();
  });

  it('shows Elo trajectory when expanded with history', () => {
    const history = { [baseDiff.variantId]: [{ iteration: 1, elo: 1200 }, { iteration: 2, elo: 1250 }] };
    render(<OutputVariantsSection variantDiffs={[baseDiff]} eloHistory={history} runId="run-1" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Elo trajectory: 1200 → 1250')).toBeInTheDocument();
  });
});
