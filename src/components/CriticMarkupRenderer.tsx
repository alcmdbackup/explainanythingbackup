'use client';

import React from 'react';

interface CriticMarkupRendererProps {
  content: string;
  className?: string;
}

/**
 * Renders CriticMarkup syntax as visual insertions, deletions, and updates
 * - Parses {--deleted text--} and renders as red strikethrough
 * - Parses {++inserted text++} and renders as green underlined
 * - Parses {~~old~>new~~} and renders as orange (old) and purple (new) paired together
 * - Regular text is rendered normally
 * - Handles newlines properly by preserving them in the content
 */
export function CriticMarkupRenderer({ content, className = '' }: CriticMarkupRendererProps) {
  // Regex to match CriticMarkup patterns: {--content--}, {++content++}, and {~~old~>new~~}
  const criticMarkupRegex = /\{([+-~]{2})([\s\S]*?)\1\}/g;
  
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
      // Inserted text - green without underline
      parts.push(
        <span
          key={`ins-${match.index}`}
          className="bg-green-100 text-green-800 px-1 rounded whitespace-pre-wrap"
          title="Inserted text"
        >
          {innerContent}
        </span>
      );
    } else if (type === '~~') {
      // Update text - parse old~>new pattern
      const updateParts = innerContent.split('~>');
      if (updateParts.length === 2) {
        const [oldText, newText] = updateParts;
        
        // Check if this is a paragraph-level update (contains newlines)
        const isParagraphUpdate = oldText.includes('\n') || newText.includes('\n');
        
        if (isParagraphUpdate) {
          // Vertical layout for paragraph updates
          parts.push(
            <div
              key={`update-${match.index}`}
              className="block my-2"
              title="Updated paragraph"
            >
              <div className="mb-2">
                <div className="bg-orange-100 text-orange-800 line-through px-2 py-1 rounded whitespace-pre-wrap border-l-4 border-orange-300">
                  {oldText}
                </div>
              </div>
              <div className="bg-purple-100 text-purple-800 px-2 py-1 rounded whitespace-pre-wrap border-l-4 border-purple-300">
                {newText}
              </div>
            </div>
          );
        } else {
          // Horizontal layout for inline updates
          parts.push(
            <span
              key={`update-${match.index}`}
              className="inline-flex items-center gap-1"
              title="Updated text"
            >
              <span className="bg-orange-100 text-orange-800 line-through px-1 rounded whitespace-pre-wrap">
                {oldText}
              </span>
              <span className="text-gray-500">→</span>
              <span className="bg-purple-100 text-purple-800 px-1 rounded whitespace-pre-wrap">
                {newText}
              </span>
            </span>
          );
        }
      } else {
        // Fallback if pattern is malformed
        parts.push(innerContent);
      }
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
  
  const criticMarkupRegex = /\{([+-~]{2})([\s\S]*?)\1\}/g;
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
    
    // Special handling for update patterns
    if (match[1] === '~~') {
      const updateParts = match[2]?.split('~>');
      if (updateParts && updateParts.length === 2) {
        const [oldText, newText] = updateParts;
        const isParagraphUpdate = oldText.includes('\n') || newText.includes('\n');
        console.log('  Update - Old text:', oldText);
        console.log('  Update - New text:', newText);
        console.log('  Update - Is paragraph update:', isParagraphUpdate);
      } else {
        console.log('  ⚠️  Malformed update pattern');
      }
    }
    console.log('---');
  }
  
  console.log(`📊 Total matches found: ${matchCount}`);
}
