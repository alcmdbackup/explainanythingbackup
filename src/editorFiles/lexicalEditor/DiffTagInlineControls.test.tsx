/**
 * Tests for DiffTagInlineControls.tsx
 * Tests inline button rendering, portal behavior, and button interactions
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DiffTagInlineControls, { type DiffTagInlineControlsProps } from './DiffTagInlineControls';

// ============= Test Helpers =============

const createMockTargetElement = (): HTMLElement => {
  const element = document.createElement('span');
  element.className = 'diff-tag-insert';
  document.body.appendChild(element);
  return element;
};

const defaultProps: DiffTagInlineControlsProps = {
  targetElement: null as unknown as HTMLElement,
  nodeKey: 'test-key',
  diffTagType: 'ins',
  onAccept: jest.fn(),
  onReject: jest.fn(),
};

// ============= Portal Rendering Tests =============

describe('DiffTagInlineControls - Portal Rendering', () => {
  let targetElement: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    targetElement = createMockTargetElement();
  });

  afterEach(() => {
    if (targetElement.parentNode) {
      targetElement.parentNode.removeChild(targetElement);
    }
  });

  it('should create controls container in target element', async () => {
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} />);

    await waitFor(() => {
      const controlsContainer = targetElement.querySelector('.diff-tag-controls');
      expect(controlsContainer).toBeInTheDocument();
    });
  });

  it('should render accept and reject buttons in container', async () => {
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} />);

    await waitFor(() => {
      const acceptButton = targetElement.querySelector('.diff-accept-btn');
      const rejectButton = targetElement.querySelector('.diff-reject-btn');
      expect(acceptButton).toBeInTheDocument();
      expect(rejectButton).toBeInTheDocument();
    });
  });

  it('should render checkmark and X symbols', async () => {
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} />);

    await waitFor(() => {
      const acceptButton = targetElement.querySelector('.diff-accept-btn');
      const rejectButton = targetElement.querySelector('.diff-reject-btn');
      expect(acceptButton?.textContent).toBe('✓');
      expect(rejectButton?.textContent).toBe('✕');
    });
  });

  it('should cleanup container on unmount', async () => {
    const { unmount } = render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} />);

    await waitFor(() => {
      expect(targetElement.querySelector('.diff-tag-controls')).toBeInTheDocument();
    });

    unmount();

    expect(targetElement.querySelector('.diff-tag-controls')).not.toBeInTheDocument();
  });

  it('should reuse existing controls container if present', async () => {
    // Create existing controls container
    const existingContainer = document.createElement('span');
    existingContainer.className = 'diff-tag-controls';
    targetElement.appendChild(existingContainer);

    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} />);

    await waitFor(() => {
      // Should only have one controls container
      const containers = targetElement.querySelectorAll('.diff-tag-controls');
      expect(containers.length).toBe(1);
    });
  });
});

// ============= Button Interactions Tests =============

describe('DiffTagInlineControls - Button Interactions', () => {
  let targetElement: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    targetElement = createMockTargetElement();
  });

  afterEach(() => {
    if (targetElement.parentNode) {
      targetElement.parentNode.removeChild(targetElement);
    }
  });

  it('should call onAccept when accept button clicked', async () => {
    const onAccept = jest.fn();
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} onAccept={onAccept} />);

    await waitFor(() => {
      const acceptButton = targetElement.querySelector('.diff-accept-btn');
      expect(acceptButton).toBeInTheDocument();
    });

    const acceptButton = targetElement.querySelector('.diff-accept-btn');
    fireEvent.click(acceptButton!);

    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('should call onReject when reject button clicked', async () => {
    const onReject = jest.fn();
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} onReject={onReject} />);

    await waitFor(() => {
      const rejectButton = targetElement.querySelector('.diff-reject-btn');
      expect(rejectButton).toBeInTheDocument();
    });

    const rejectButton = targetElement.querySelector('.diff-reject-btn');
    fireEvent.click(rejectButton!);

    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('should stop event propagation on accept click', async () => {
    const parentClickHandler = jest.fn();
    const onAccept = jest.fn();

    const wrapper = document.createElement('div');
    wrapper.addEventListener('click', parentClickHandler);
    wrapper.appendChild(targetElement);
    document.body.appendChild(wrapper);

    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} onAccept={onAccept} />);

    await waitFor(() => {
      const acceptButton = targetElement.querySelector('.diff-accept-btn');
      expect(acceptButton).toBeInTheDocument();
    });

    const acceptButton = targetElement.querySelector('.diff-accept-btn');
    fireEvent.click(acceptButton!);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(parentClickHandler).not.toHaveBeenCalled();

    wrapper.removeChild(targetElement);
    document.body.removeChild(wrapper);
  });

  it('should stop event propagation on reject click', async () => {
    const parentClickHandler = jest.fn();
    const onReject = jest.fn();

    const wrapper = document.createElement('div');
    wrapper.addEventListener('click', parentClickHandler);
    wrapper.appendChild(targetElement);
    document.body.appendChild(wrapper);

    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} onReject={onReject} />);

    await waitFor(() => {
      const rejectButton = targetElement.querySelector('.diff-reject-btn');
      expect(rejectButton).toBeInTheDocument();
    });

    const rejectButton = targetElement.querySelector('.diff-reject-btn');
    fireEvent.click(rejectButton!);

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(parentClickHandler).not.toHaveBeenCalled();

    wrapper.removeChild(targetElement);
    document.body.removeChild(wrapper);
  });
});

// ============= Title Attributes Tests =============

describe('DiffTagInlineControls - Title Attributes', () => {
  let targetElement: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    targetElement = createMockTargetElement();
  });

  afterEach(() => {
    if (targetElement.parentNode) {
      targetElement.parentNode.removeChild(targetElement);
    }
  });

  it('should show correct titles for ins diffTagType', async () => {
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} diffTagType="ins" />);

    await waitFor(() => {
      const acceptButton = targetElement.querySelector('.diff-accept-btn');
      const rejectButton = targetElement.querySelector('.diff-reject-btn');
      expect(acceptButton).toHaveAttribute('title', 'Accept this addition');
      expect(rejectButton).toHaveAttribute('title', 'Reject this addition');
    });
  });

  it('should show correct titles for del diffTagType', async () => {
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} diffTagType="del" />);

    await waitFor(() => {
      const acceptButton = targetElement.querySelector('.diff-accept-btn');
      const rejectButton = targetElement.querySelector('.diff-reject-btn');
      expect(acceptButton).toHaveAttribute('title', 'Accept this deletion');
      expect(rejectButton).toHaveAttribute('title', 'Reject this deletion');
    });
  });

  it('should show correct titles for update diffTagType', async () => {
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} diffTagType="update" />);

    await waitFor(() => {
      const acceptButton = targetElement.querySelector('.diff-accept-btn');
      const rejectButton = targetElement.querySelector('.diff-reject-btn');
      expect(acceptButton).toHaveAttribute('title', 'Accept this change');
      expect(rejectButton).toHaveAttribute('title', 'Reject this change');
    });
  });
});

// ============= Button Type Tests =============

describe('DiffTagInlineControls - Button Type', () => {
  let targetElement: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    targetElement = createMockTargetElement();
  });

  afterEach(() => {
    if (targetElement.parentNode) {
      targetElement.parentNode.removeChild(targetElement);
    }
  });

  it('should have type="button" to prevent form submission', async () => {
    render(<DiffTagInlineControls {...defaultProps} targetElement={targetElement} />);

    await waitFor(() => {
      const acceptButton = targetElement.querySelector('.diff-accept-btn');
      const rejectButton = targetElement.querySelector('.diff-reject-btn');
      expect(acceptButton).toHaveAttribute('type', 'button');
      expect(rejectButton).toHaveAttribute('type', 'button');
    });
  });
});
