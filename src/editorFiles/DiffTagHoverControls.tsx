'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface DiffTagHoverControlsProps {
  targetElement: HTMLElement;
  diffTagType: 'ins' | 'del' | 'update';
  onAccept: () => void;
  onReject: () => void;
  onClose: () => void;
}

/**
 * Hover controls component that appears when user hovers over a diff tag node
 *
 * • Displays green "Accept" and red "Reject" buttons
 * • Positioned at the bottom-right corner of the target element's last child
 * • Remains visible when mouse moves slightly away from diff tag for better UX
 * • Uses fixed positioning to overlay on top of content
 * • Calls onAccept/onReject when buttons are clicked
 * • Calls onClose when mouse leaves the control area
 */
const DiffTagHoverControls: React.FC<DiffTagHoverControlsProps> = ({
  targetElement,
  diffTagType,
  onAccept,
  onReject,
  onClose
}) => {
  console.log('🎨 DiffTagHoverControls: COMPONENT RENDER START');
  console.log('🎨 DiffTagHoverControls rendering with:', {
    diffTagType,
    targetElement: !!targetElement,
    targetElementDetails: targetElement ? {
      tagName: targetElement.tagName,
      className: targetElement.className,
      textContent: targetElement.textContent?.substring(0, 50)
    } : null
  });

  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();

  // Calculate position based on the last child of the target element
  useEffect(() => {
    if (!targetElement) return;

    const updatePosition = () => {
      console.log('🔍 DiffTagHoverControls: DETAILED ELEMENT ANALYSIS');
      console.log('🔍 Target element:', targetElement);
      console.log('🔍 Target element tagName:', targetElement.tagName);
      console.log('🔍 Target element className:', targetElement.className);
      console.log('🔍 Target element textContent:', targetElement.textContent?.substring(0, 100));
      console.log('🔍 Target element children count:', targetElement.children.length);

      // Log all children of target element
      Array.from(targetElement.children).forEach((child, index) => {
        console.log(`🔍 Child ${index}:`, {
          tagName: child.tagName,
          className: child.className,
          textContent: child.textContent?.substring(0, 50),
          rect: child.getBoundingClientRect()
        });
      });

      // Also log all child nodes (including text nodes)
      Array.from(targetElement.childNodes).forEach((child, index) => {
        if (child.nodeType === Node.TEXT_NODE) {
          console.log(`🔍 Text Node ${index}:`, {
            textContent: child.textContent?.substring(0, 50),
            parentElement: child.parentElement?.tagName
          });
        }
      });

      // Find the last child element to position controls at its bottom-left
      const lastChild = targetElement.lastElementChild || targetElement;
      const targetRect = targetElement.getBoundingClientRect();
      const lastChildRect = lastChild.getBoundingClientRect();

      console.log('🔍 Target element rect:', targetRect);
      console.log('🔍 Last child element:', lastChild);
      console.log('🔍 Last child tagName:', lastChild.tagName);
      console.log('🔍 Last child className:', lastChild.className);
      console.log('🔍 Last child rect:', lastChildRect);

      // Try using the target element itself if it seems more appropriate
      const useTargetElement = targetRect.height < 100; // Use target if it's not too tall
      const positioningElement = useTargetElement ? targetElement : lastChild;
      let rect = positioningElement.getBoundingClientRect();

      // Alternative approach: try to find text range bounds
      let textBasedRect: DOMRect | null = null;
      try {
        const textContent = targetElement.textContent || '';
        if (textContent.length > 0) {
          const range = document.createRange();
          range.selectNodeContents(targetElement);
          textBasedRect = range.getBoundingClientRect();
          console.log('🔍 Text-based rect:', textBasedRect);
        }
      } catch (e) {
        console.log('🔍 Could not get text-based rect:', e);
      }

      // Use text-based rect if it seems more reasonable (smaller height)
      if (textBasedRect && textBasedRect.height < rect.height && textBasedRect.height > 0) {
        rect = textBasedRect;
        console.log('🔍 Using text-based positioning');
      } else {
        console.log('🔍 Using element-based positioning');
      }

      console.log('🔍 Using element:', useTargetElement ? 'target' : 'lastChild');
      console.log('🔍 Final positioning rect:', rect);

      // Position at bottom-left corner with some padding
      // NOTE: getBoundingClientRect() returns viewport-relative coordinates, so no need to add scroll offsets
      let top = rect.bottom + 4;
      let left = rect.left; // Position at left edge of positioning element

      // Ensure controls don't go below viewport
      const controlsHeight = 40; // Approximate height of controls
      const maxTop = window.innerHeight - controlsHeight - 10;
      if (top > maxTop) {
        top = rect.top - controlsHeight - 4; // Position above instead
      }

      // Ensure controls don't go off left edge
      if (left < 10) {
        left = 10;
      }

      // Ensure controls don't go off right edge (since we're at left edge, check if controls extend beyond viewport)
      const controlsWidth = 120; // Approximate width of controls
      const maxLeft = window.innerWidth - controlsWidth - 10;
      if (left > maxLeft) {
        left = maxLeft;
      }

      const newPosition = { top, left };

      console.log('📍 DiffTagHoverControls: Positioning controls at bottom-left of last child', {
        lastChildRect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
        calculatedPosition: newPosition,
        viewportSize: { width: window.innerWidth, height: window.innerHeight },
        targetElement: targetElement.tagName,
        lastChildElement: lastChild.tagName,
        note: 'Using viewport-relative coordinates (no scroll offset added)'
      });

      setPosition(newPosition);
    };

    updatePosition();
    setIsVisible(true);

    // Update position on scroll or resize
    const handleUpdate = () => updatePosition();
    window.addEventListener('scroll', handleUpdate);
    window.addEventListener('resize', handleUpdate);

    return () => {
      window.removeEventListener('scroll', handleUpdate);
      window.removeEventListener('resize', handleUpdate);
    };
  }, [targetElement]);

  // Handle mouse events for hover tolerance - only close when mouse truly leaves both areas
  useEffect(() => {
    const handleMouseLeave = (event: MouseEvent) => {
      console.log('🚪 DiffTagHoverControls: Mouse leave detected');
      // Add delay before closing to allow user to move to controls
      timeoutRef.current = setTimeout(() => {
        console.log('⏰ DiffTagHoverControls: Timeout triggered, checking if should close');
        onClose();
      }, 2000); // Much longer delay for testing
    };

    const handleMouseEnter = () => {
      console.log('🚪 DiffTagHoverControls: Mouse enter detected, clearing timeout');
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
    };

    // Add listeners to target element
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

  console.log('🎨 DiffTagHoverControls render decision:', { isVisible });

  if (!isVisible) {
    console.log('❌ DiffTagHoverControls not rendering - not visible');
    return null;
  }

  console.log('✅ DiffTagHoverControls: Actually rendering controls!');

  return (
    <div
      ref={controlsRef}
      className="fixed z-50 flex gap-2 p-2 bg-yellow-200 border-2 border-red-500 rounded-md shadow-2xl"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      // Prevent text selection and handle mouse events on the controls
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => {
        console.log('🎯 DiffTagHoverControls: Mouse entered controls');
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
      }}
      onMouseLeave={() => {
        console.log('🎯 DiffTagHoverControls: Mouse left controls');
        timeoutRef.current = setTimeout(() => {
          console.log('⏰ DiffTagHoverControls: Controls timeout triggered, closing');
          onClose();
        }, 200);
      }}
    >
      {/* Accept button */}
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

      {/* Reject button */}
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