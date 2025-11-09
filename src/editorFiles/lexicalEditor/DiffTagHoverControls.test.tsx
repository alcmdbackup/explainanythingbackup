/**
 * Tests for DiffTagHoverControls.tsx (Phase 7E)
 * Tests hover UI positioning, timeout behavior, and button interactions
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import DiffTagHoverControls, { type DiffTagHoverControlsProps } from './DiffTagHoverControls';

// ============= Test Helpers =============

const createMockTargetElement = (rect: Partial<DOMRect> = {}): HTMLElement => {
  const element = document.createElement('span');
  element.getBoundingClientRect = jest.fn(() => ({
    top: rect.top ?? 100,
    left: rect.left ?? 200,
    right: rect.right ?? 300,
    bottom: rect.bottom ?? 120,
    width: rect.width ?? 100,
    height: rect.height ?? 20,
    x: rect.x ?? 200,
    y: rect.y ?? 100,
    toJSON: () => ({}),
  }));
  return element;
};

const defaultProps: DiffTagHoverControlsProps = {
  targetElement: createMockTargetElement(),
  diffTagType: 'ins',
  onAccept: jest.fn(),
  onReject: jest.fn(),
  onClose: jest.fn(),
};

// ============= Positioning Logic Tests =============

describe('DiffTagHoverControls - Positioning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should position to right of targetElement by default', () => {
    const targetElement = createMockTargetElement({ right: 300, top: 100, height: 20 });

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} />);

    const controls = screen.getByText('Accept').closest('div');
    expect(controls).toHaveStyle({
      left: '308px', // right (300) + 8px padding
      top: '110px', // top (100) + height/2 (10)
    });
  });

  it('should position to left when would overflow right edge', () => {
    // Set viewport width
    Object.defineProperty(window, 'innerWidth', { value: 400, writable: true });

    const targetElement = createMockTargetElement({
      left: 350,
      right: 380,
      top: 100,
      height: 20
    });

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} />);

    const controls = screen.getByText('Accept').closest('div');
    // Should position to left: left (350) - controlsWidth (120) - 8px padding = 222px
    expect(controls).toHaveStyle({
      left: '222px',
    });
  });

  it('should prevent overflow off bottom of viewport', () => {
    Object.defineProperty(window, 'innerHeight', { value: 600, writable: true });

    const targetElement = createMockTargetElement({
      top: 580,
      height: 20,
      right: 300
    });

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} />);

    const controls = screen.getByText('Accept').closest('div');
    // Should be clamped to maxTop: window.innerHeight (600) - height (50) - 10 = 540px
    const topValue = controls?.style.top;
    expect(parseInt(topValue || '0')).toBeLessThanOrEqual(540);
  });

  it('should prevent overflow off top of viewport', () => {
    const targetElement = createMockTargetElement({
      top: 0,
      height: 20,
      right: 300
    });

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} />);

    const controls = screen.getByText('Accept').closest('div');
    // Should be clamped to minimum 10px
    expect(controls).toHaveStyle({
      top: '10px',
    });
  });

  it('should update position on scroll', () => {
    // Set viewport dimensions to ensure right-side positioning
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, writable: true, configurable: true });

    const targetElement = createMockTargetElement({ top: 100, right: 300, height: 20 });

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} />);

    // Update the mock to return new position
    (targetElement.getBoundingClientRect as jest.Mock).mockReturnValue({
      top: 200,
      left: 250,
      right: 350,
      bottom: 220,
      width: 100,
      height: 20,
      x: 250,
      y: 200,
      toJSON: () => ({}),
    });

    // Trigger scroll event
    act(() => {
      fireEvent.scroll(window);
    });

    const controls = screen.getByText('Accept').closest('div');
    expect(controls).toHaveStyle({
      top: '210px', // new top (200) + height/2 (10)
      left: '358px', // new right (350) + 8px
    });
  });

  it('should update position on resize', () => {
    const targetElement = createMockTargetElement({ top: 100, right: 300, height: 20 });

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} />);

    // Trigger resize event
    act(() => {
      fireEvent(window, new Event('resize'));
    });

    // Position should be recalculated
    const controls = screen.getByText('Accept').closest('div');
    expect(controls).toBeInTheDocument();
  });
});

// ============= Visibility Management Tests =============

describe('DiffTagHoverControls - Visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should show controls when targetElement provided', () => {
    render(<DiffTagHoverControls {...defaultProps} />);

    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('should become visible after position is calculated', async () => {
    const { container } = render(<DiffTagHoverControls {...defaultProps} />);

    await waitFor(() => {
      const controls = container.querySelector('.fixed');
      expect(controls).toBeInTheDocument();
    });
  });
});

// ============= Hover Timeout Behavior Tests =============

describe('DiffTagHoverControls - Hover Timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should delay onClose by 200ms on target element mouseleave', () => {
    const onClose = jest.fn();
    const targetElement = createMockTargetElement();

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} onClose={onClose} />);

    // Trigger mouseleave on target element
    act(() => {
      fireEvent.mouseLeave(targetElement);
    });

    // Should not call onClose immediately
    expect(onClose).not.toHaveBeenCalled();

    // Advance timers by 200ms
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // Now onClose should be called
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should cancel timeout on target element mouseenter', () => {
    const onClose = jest.fn();
    const targetElement = createMockTargetElement();

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} onClose={onClose} />);

    // Trigger mouseleave
    act(() => {
      fireEvent.mouseLeave(targetElement);
    });

    // Advance timers partially
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Trigger mouseenter before timeout completes
    act(() => {
      fireEvent.mouseEnter(targetElement);
    });

    // Advance remaining time
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // onClose should not be called
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should delay onClose on controls div mouseleave', () => {
    const onClose = jest.fn();

    render(<DiffTagHoverControls {...defaultProps} onClose={onClose} />);

    const controls = screen.getByText('Accept').closest('div');

    // Trigger mouseleave on controls
    act(() => {
      fireEvent.mouseLeave(controls!);
    });

    // Should not call onClose immediately
    expect(onClose).not.toHaveBeenCalled();

    // Advance timers by 200ms
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // Now onClose should be called
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should cancel timeout on controls div mouseenter', () => {
    const onClose = jest.fn();

    render(<DiffTagHoverControls {...defaultProps} onClose={onClose} />);

    const controls = screen.getByText('Accept').closest('div');

    // Trigger mouseleave
    act(() => {
      fireEvent.mouseLeave(controls!);
    });

    // Advance timers partially
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Trigger mouseenter before timeout completes
    act(() => {
      fireEvent.mouseEnter(controls!);
    });

    // Advance remaining time
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // onClose should not be called
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should cleanup timeout on unmount', () => {
    const onClose = jest.fn();
    const targetElement = createMockTargetElement();

    const { unmount } = render(
      <DiffTagHoverControls {...defaultProps} targetElement={targetElement} onClose={onClose} />
    );

    // Trigger mouseleave
    act(() => {
      fireEvent.mouseLeave(targetElement);
    });

    // Unmount before timeout completes
    unmount();

    // Advance timers
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // onClose should not be called after unmount
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ============= Button Interactions Tests =============

describe('DiffTagHoverControls - Button Interactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should call onAccept and stop propagation when Accept clicked', () => {
    const onAccept = jest.fn();
    const parentClickHandler = jest.fn();

    const { container } = render(
      <div onClick={parentClickHandler}>
        <DiffTagHoverControls {...defaultProps} onAccept={onAccept} />
      </div>
    );

    const acceptButton = screen.getByText('Accept');
    fireEvent.click(acceptButton);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(parentClickHandler).not.toHaveBeenCalled(); // Event should not propagate
  });

  it('should call onReject and stop propagation when Reject clicked', () => {
    const onReject = jest.fn();
    const parentClickHandler = jest.fn();

    render(
      <div onClick={parentClickHandler}>
        <DiffTagHoverControls {...defaultProps} onReject={onReject} />
      </div>
    );

    const rejectButton = screen.getByText('Reject');
    fireEvent.click(rejectButton);

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(parentClickHandler).not.toHaveBeenCalled(); // Event should not propagate
  });

  it('should show correct title for ins diffTagType', () => {
    render(<DiffTagHoverControls {...defaultProps} diffTagType="ins" />);

    const acceptButton = screen.getByText('Accept');
    const rejectButton = screen.getByText('Reject');

    expect(acceptButton).toHaveAttribute('title', 'Accept this addition');
    expect(rejectButton).toHaveAttribute('title', 'Reject this addition');
  });

  it('should show correct title for del diffTagType', () => {
    render(<DiffTagHoverControls {...defaultProps} diffTagType="del" />);

    const acceptButton = screen.getByText('Accept');
    const rejectButton = screen.getByText('Reject');

    expect(acceptButton).toHaveAttribute('title', 'Accept this deletion');
    expect(rejectButton).toHaveAttribute('title', 'Reject this deletion');
  });

  it('should show correct title for update diffTagType', () => {
    render(<DiffTagHoverControls {...defaultProps} diffTagType="update" />);

    const acceptButton = screen.getByText('Accept');
    const rejectButton = screen.getByText('Reject');

    expect(acceptButton).toHaveAttribute('title', 'Accept this change');
    expect(rejectButton).toHaveAttribute('title', 'Reject this change');
  });
});

// ============= Edge Cases Tests =============

describe('DiffTagHoverControls - Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should handle scrollable parent container', () => {
    const targetElement = createMockTargetElement();
    const scrollableParent = document.createElement('div');
    scrollableParent.className = 'overflow-y-auto';
    scrollableParent.appendChild(targetElement);
    document.body.appendChild(scrollableParent);

    targetElement.closest = jest.fn().mockReturnValue(scrollableParent);
    const scrollListener = jest.fn();
    scrollableParent.addEventListener = jest.fn();

    render(<DiffTagHoverControls {...defaultProps} targetElement={targetElement} />);

    // Should add scroll listener to scrollable parent
    expect(scrollableParent.addEventListener).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function)
    );

    document.body.removeChild(scrollableParent);
  });

  it('should cleanup scroll listeners on unmount', () => {
    const targetElement = createMockTargetElement();
    const removeEventListener = jest.spyOn(window, 'removeEventListener');

    const { unmount } = render(
      <DiffTagHoverControls {...defaultProps} targetElement={targetElement} />
    );

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    removeEventListener.mockRestore();
  });

  it('should cleanup target element listeners on unmount', () => {
    const targetElement = createMockTargetElement();
    const removeEventListener = jest.spyOn(targetElement, 'removeEventListener');

    const { unmount } = render(
      <DiffTagHoverControls {...defaultProps} targetElement={targetElement} />
    );

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('mouseenter', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('mouseleave', expect.any(Function));
  });
});
