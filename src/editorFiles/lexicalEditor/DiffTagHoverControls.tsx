'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface DiffTagHoverControlsProps {
  targetElement: HTMLElement;
  diffTagType: 'ins' | 'del' | 'update';
  onAccept: () => void;
  onReject: () => void;
  onClose: () => void;
}

const DiffTagHoverControls: React.FC<DiffTagHoverControlsProps> = ({
  targetElement,
  diffTagType,
  onAccept,
  onReject,
  onClose
}) => {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Calculate position - simple and direct
  useEffect(() => {
    if (!targetElement) return;

    const updatePosition = () => {
      const rect = targetElement.getBoundingClientRect();

      // Position at the right boundary of the diff tag element
      let top = rect.top;
      let left = rect.right + 8; // 8px padding to the right of the element

      // Ensure buttons don't go off right edge of viewport
      const controlsWidth = 120; // Approximate width of both buttons
      const maxLeft = window.innerWidth - controlsWidth - 10;
      if (left > maxLeft) {
        left = rect.left - controlsWidth - 8; // Position to the left instead
      }

      // Ensure buttons don't go off bottom of viewport
      const controlsHeight = 40; // Approximate height
      const maxTop = window.innerHeight - controlsHeight - 10;
      if (top > maxTop) {
        top = maxTop;
      }

      // Ensure buttons don't go above viewport
      if (top < 10) {
        top = 10;
      }

      setPosition({ top, left });
    };

    updatePosition();
    setIsVisible(true);

    // Update position on scroll or resize
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    // Also listen for scroll on parent containers that might affect positioning
    const scrollableParent = targetElement.closest('.overflow-y-auto');
    if (scrollableParent) {
      scrollableParent.addEventListener('scroll', updatePosition);
    }

    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
      if (scrollableParent) {
        scrollableParent.removeEventListener('scroll', updatePosition);
      }
    };
  }, [targetElement]);

  // Handle hover timeout for smooth UX
  useEffect(() => {
    const handleMouseLeave = () => {
      timeoutRef.current = setTimeout(() => {
        onClose();
      }, 200);
    };

    const handleMouseEnter = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
    };

    targetElement.addEventListener('mouseenter', handleMouseEnter);
    targetElement.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      targetElement.removeEventListener('mouseenter', handleMouseEnter);
      targetElement.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [targetElement, onClose]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={controlsRef}
      className="fixed z-50 flex gap-2 p-2 bg-white border border-gray-300 rounded-md shadow-lg"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onMouseEnter={() => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
      }}
      onMouseLeave={() => {
        timeoutRef.current = setTimeout(() => {
          onClose();
        }, 200);
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAccept();
        }}
        className="px-2 py-1 text-xs font-medium text-white bg-green-600 border border-green-700 rounded hover:bg-green-700 transition-colors duration-150"
        title={`Accept this ${diffTagType === 'update' ? 'change' : diffTagType === 'ins' ? 'addition' : 'deletion'}`}
      >
        Accept
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onReject();
        }}
        className="px-2 py-1 text-xs font-medium text-white bg-red-600 border border-red-700 rounded hover:bg-red-700 transition-colors duration-150"
        title={`Reject this ${diffTagType === 'update' ? 'change' : diffTagType === 'ins' ? 'addition' : 'deletion'}`}
      >
        Reject
      </button>
    </div>
  );
};

export default DiffTagHoverControls;