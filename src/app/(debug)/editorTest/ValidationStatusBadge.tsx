'use client';

import { ValidationResult } from '@/editorFiles/validation/pipelineValidation';
import { useState } from 'react';

interface ValidationStatusBadgeProps {
  result?: ValidationResult & { description: string };
  stepName: string;
}

export function ValidationStatusBadge({ result, stepName }: ValidationStatusBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!result) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
        Not run
      </span>
    );
  }

  const { valid, issues, severity, description } = result;

  const getBadgeClasses = () => {
    if (valid) {
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-900/50';
    }
    if (severity === 'error') {
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-900/50';
    }
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 hover:bg-yellow-200 dark:hover:bg-yellow-900/50';
  };

  const getIcon = () => {
    if (valid) return '\u2713'; // checkmark
    if (severity === 'error') return '\u2717'; // X
    return '\u26A0'; // warning
  };

  return (
    <div className="inline-block relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${getBadgeClasses()}`}
      >
        <span>{getIcon()}</span>
        <span>{stepName}</span>
        {issues.length > 0 && (
          <span className="opacity-70">({issues.length})</span>
        )}
        <span className="ml-1 text-[10px]">{isExpanded ? '\u25BC' : '\u25B6'}</span>
      </button>

      {isExpanded && (
        <div className="absolute top-full left-0 mt-1 z-10 min-w-[300px] max-w-[400px] p-3 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 shadow-lg text-sm">
          <p className="text-gray-600 dark:text-gray-400 mb-2 text-xs italic">{description}</p>
          {issues.length > 0 ? (
            <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
              {issues.map((issue, idx) => (
                <li key={idx} className="text-xs">{issue}</li>
              ))}
            </ul>
          ) : (
            <p className="text-green-600 dark:text-green-400 text-xs">All checks passed</p>
          )}
        </div>
      )}
    </div>
  );
}
