/**
 * ShareButton - Reusable component for copying URLs to clipboard.
 * Shows "Copied!" feedback for 2 seconds after successful copy.
 */
'use client';

import { useState } from 'react';
import { LinkIcon, CheckIcon } from '@heroicons/react/24/outline';

interface ShareButtonProps {
  url: string;
  variant?: 'icon' | 'text';
  className?: string;
}

export default function ShareButton({ url, variant = 'text', className = '' }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleShare}
      className={`inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ${className}`}
      aria-label={copied ? 'Link copied' : 'Share link'}
    >
      {copied ? (
        <CheckIcon className="w-4 h-4 text-green-500" />
      ) : (
        <LinkIcon className="w-4 h-4" />
      )}
      {variant === 'text' && (
        <span className="text-sm">{copied ? 'Copied!' : 'Share'}</span>
      )}
    </button>
  );
}
