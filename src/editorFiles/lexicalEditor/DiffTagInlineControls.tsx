'use client';

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface DiffTagInlineControlsProps {
  targetElement: HTMLElement;
  nodeKey: string;
  diffTagType: 'ins' | 'del' | 'update';
  onAccept: () => void;
  onReject: () => void;
}

const DiffTagInlineControls: React.FC<DiffTagInlineControlsProps> = ({
  targetElement,
  diffTagType,
  onAccept,
  onReject
}) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const controlsRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Check if controls already exist in this element
    const existingControls = targetElement.querySelector('.diff-tag-controls');
    if (existingControls) {
      setContainer(existingControls as HTMLElement);
      return;
    }

    // Create a container for the controls and append to target element
    const controlsContainer = document.createElement('span');
    controlsContainer.className = 'diff-tag-controls';
    targetElement.appendChild(controlsContainer);
    setContainer(controlsContainer);

    return () => {
      // Clean up on unmount
      if (controlsContainer.parentNode === targetElement) {
        targetElement.removeChild(controlsContainer);
      }
    };
  }, [targetElement]);

  if (!container) {
    return null;
  }

  const getAcceptTitle = () => {
    switch (diffTagType) {
      case 'ins': return 'Accept this addition';
      case 'del': return 'Accept this deletion';
      case 'update': return 'Accept this change';
    }
  };

  const getRejectTitle = () => {
    switch (diffTagType) {
      case 'ins': return 'Reject this addition';
      case 'del': return 'Reject this deletion';
      case 'update': return 'Reject this change';
    }
  };

  return createPortal(
    <span ref={controlsRef} style={{ display: 'contents' }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onAccept();
        }}
        className="diff-accept-btn"
        title={getAcceptTitle()}
        type="button"
      >
        ✓
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onReject();
        }}
        className="diff-reject-btn"
        title={getRejectTitle()}
        type="button"
      >
        ✕
      </button>
    </span>,
    container
  );
};

export default DiffTagInlineControls;
