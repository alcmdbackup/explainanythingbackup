import { type ReactNode } from 'react';

interface MasonryGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * MasonryGrid - CSS columns-based masonry layout
 * Responsive: 1 col mobile, 2 col tablet, 3 col desktop, 4 col large
 */
export default function MasonryGrid({ children, className = '' }: MasonryGridProps) {
  return (
    <div
      className={`
        columns-1 sm:columns-2 lg:columns-3 xl:columns-4
        gap-6
        [column-fill:balance]
        ${className}
      `}
    >
      {children}
    </div>
  );
}
