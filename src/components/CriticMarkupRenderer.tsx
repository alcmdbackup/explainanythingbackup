'use client';

import React from 'react';

interface CriticMarkupRendererProps {
  content: string;
  className?: string;
}

/**
 * Renders CriticMarkup syntax as visual insertions and deletions
 * - Parses {--deleted text--} and renders as red strikethrough
 * - Parses {++inserted text++} and renders as green underlined
 * - Regular text is rendered normally
 * - Handles newlines properly by preserving them in the content
 */
export function CriticMarkupRenderer({ content, className = '' }: CriticMarkupRendererProps) {
  // Regex to match CriticMarkup patterns: {--content--} and {++content++}
  const criticMarkupRegex = /\{([+-]{2})([\s\S]*?)\1\}/g;
  
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = criticMarkupRegex.exec(content)) !== null) {
    // Add any text before the match
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    const [fullMatch, type, innerContent] = match;
    
    if (type === '--') {
      // Deleted text - red with strikethrough
      parts.push(
        <span
          key={`del-${match.index}`}
          className="bg-red-100 text-red-800 line-through px-1 rounded whitespace-pre-wrap"
          title="Deleted text"
        >
          {innerContent}
        </span>
      );
    } else if (type === '++') {
      // Inserted text - green with underline
      parts.push(
        <span
          key={`ins-${match.index}`}
          className="bg-green-100 text-green-800 underline px-1 rounded whitespace-pre-wrap"
          title="Inserted text"
        >
          {innerContent}
        </span>
      );
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add any remaining text after the last match
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return (
    <div className={`whitespace-pre-wrap text-sm font-mono ${className}`}>
      {parts.length > 0 ? parts : content}
    </div>
  );
}

/**
 * Debug function to test CriticMarkup parsing
 */
export function debugCriticMarkupParsing(content: string): void {
  console.log('🔍 Debugging CriticMarkup parsing for content:');
  console.log('📝 Content length:', content.length);
  console.log('📝 Content preview:', content.substring(0, 200) + '...');
  
  const criticMarkupRegex = /\{([+-]{2})([\s\S]*?)\1\}/g;
  let match;
  let matchCount = 0;
  
  while ((match = criticMarkupRegex.exec(content)) !== null) {
    matchCount++;
    console.log(`🎯 Match ${matchCount}:`);
    console.log('  Full match:', match[0]);
    console.log('  Type:', match[1]);
    console.log('  Inner content length:', match[2]?.length);
    console.log('  Inner content preview:', match[2]?.substring(0, 100) + '...');
    console.log('  Match index:', match.index);
    console.log('---');
  }
  
  console.log(`📊 Total matches found: ${matchCount}`);
}
