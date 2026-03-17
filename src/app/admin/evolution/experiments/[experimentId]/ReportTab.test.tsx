// Tests for ReportTab: V2 shows empty state since reports are not supported.
import { render, screen } from '@testing-library/react';
import { ReportTab } from './ReportTab';

describe('ReportTab', () => {
  it('renders V2 empty state message', () => {
    render(<ReportTab />);
    expect(screen.getByText('Experiment reports are not available in V2.')).toBeInTheDocument();
  });
});
