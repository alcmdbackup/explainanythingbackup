// Tests for EloSparkline component: renders wrapper, handles empty data, and passes data to chart.
import { render, screen } from '@testing-library/react';
import { EloSparkline } from './EloSparkline';

// Mock next/dynamic to render the inner component synchronously
jest.mock('next/dynamic', () => {
  return jest.fn().mockImplementation((loader: () => Promise<{ default: React.ComponentType }>) => {
    // Return a component that renders null (since recharts is mocked)
    function MockDynamic(props: Record<string, unknown>) {
      return <div data-testid="sparkline-inner" data-props={JSON.stringify(props)} />;
    }
    MockDynamic.displayName = 'MockDynamic';
    return MockDynamic;
  });
});

describe('EloSparkline', () => {
  it('renders wrapper with data-testid', () => {
    render(<EloSparkline data={[{ iteration: 1, elo: 1200 }, { iteration: 2, elo: 1250 }]} />);
    expect(screen.getByTestId('elo-sparkline')).toBeInTheDocument();
  });

  it('renders the inner dynamic component', () => {
    render(<EloSparkline data={[{ iteration: 1, elo: 1200 }, { iteration: 2, elo: 1250 }]} />);
    expect(screen.getByTestId('sparkline-inner')).toBeInTheDocument();
  });

  it('passes data through to inner component', () => {
    const data = [{ iteration: 1, elo: 1200 }, { iteration: 2, elo: 1300 }];
    render(<EloSparkline data={data} />);
    const inner = screen.getByTestId('sparkline-inner');
    const props = JSON.parse(inner.getAttribute('data-props') ?? '{}');
    expect(props.data).toEqual(data);
  });

  it('handles empty data array', () => {
    render(<EloSparkline data={[]} />);
    expect(screen.getByTestId('elo-sparkline')).toBeInTheDocument();
  });
});
