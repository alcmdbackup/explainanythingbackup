// Tests for ElapsedTime component: ticking for active, static for completed, "--" for pending.
import { render, screen, act } from '@testing-library/react';
import { ElapsedTime } from './ElapsedTime';

describe('ElapsedTime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-14T12:05:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows "--" when no startedAt', () => {
    render(<ElapsedTime startedAt={null} completedAt={null} status="pending" />);
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('shows static duration for completed run', () => {
    render(
      <ElapsedTime
        startedAt="2026-02-14T12:00:00Z"
        completedAt="2026-02-14T12:03:30Z"
        status="completed"
      />,
    );
    expect(screen.getByText('3m 30s')).toBeInTheDocument();
  });

  it('ticks for active (running) run', () => {
    render(
      <ElapsedTime
        startedAt="2026-02-14T12:00:00Z"
        completedAt={null}
        status="running"
      />,
    );
    expect(screen.getByText('5m 0s')).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(5000); });
    expect(screen.getByText('5m 5s')).toBeInTheDocument();
  });

  it('formats hours correctly', () => {
    jest.setSystemTime(new Date('2026-02-14T14:30:00Z'));
    render(
      <ElapsedTime
        startedAt="2026-02-14T12:00:00Z"
        completedAt={null}
        status="running"
      />,
    );
    expect(screen.getByText('2h 30m 0s')).toBeInTheDocument();
  });
});
