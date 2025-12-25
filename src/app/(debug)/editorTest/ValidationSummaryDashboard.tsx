'use client';

import { PipelineValidationResults, ValidationResult } from '@/editorFiles/validation/pipelineValidation';
import { useState } from 'react';

interface ValidationSummaryDashboardProps {
  results: PipelineValidationResults;
  step4Result?: ValidationResult;
}

interface CheckDefinition {
  id: string;
  name: string;
  description: string;
}

// Detailed check definitions for each step
const STEP_CHECKS: Record<string, CheckDefinition[]> = {
  step2: [
    {
      id: 'length_ratio',
      name: 'Length Ratio',
      description: 'Edited content must be between 50% and 200% of the original length. This prevents the LLM from accidentally deleting most content or generating excessive additions.',
    },
    {
      id: 'heading_preservation',
      name: 'Heading Preservation',
      description: 'At least 50% of original headings must be preserved in the edited content. This ensures document structure is maintained during editing.',
    },
    {
      id: 'unexpanded_markers',
      name: 'No Unexpanded Markers',
      description: 'The output must not contain literal "... existing text ..." markers. These indicate the LLM failed to properly expand placeholder content.',
    },
  ],
  step3: [
    {
      id: 'balanced_insertions',
      name: 'Balanced Insertions',
      description: 'Every {++ opening marker must have a matching ++} closing marker. Unbalanced markers will break the Lexical editor rendering.',
    },
    {
      id: 'balanced_deletions',
      name: 'Balanced Deletions',
      description: 'Every {-- opening marker must have a matching --} closing marker. Unbalanced markers will break the Lexical editor rendering.',
    },
    {
      id: 'balanced_substitutions',
      name: 'Balanced Substitutions',
      description: 'Every {~~ opening marker must have a matching ~~} closing marker, with a ~> separator between old and new text.',
    },
  ],
  step4: [
    {
      id: 'heading_newlines',
      name: 'Heading Newlines',
      description: 'Headings (lines starting with #) must begin on a new line. This ensures proper parsing and display in the Lexical editor.',
    },
    {
      id: 'criticmarkup_heading_format',
      name: 'CriticMarkup Heading Format',
      description: 'CriticMarkup blocks containing headings must have the heading on its own line. Mixed inline content with headings causes rendering issues.',
    },
  ],
};

function getCheckStatus(stepKey: string, checkId: string, issues: string[]): 'passed' | 'failed' | 'unknown' {
  // Map check IDs to patterns in issue messages
  const issuePatterns: Record<string, string[]> = {
    length_ratio: ['too short', 'too long', 'length'],
    heading_preservation: ['heading', 'Lost heading'],
    unexpanded_markers: ['unexpanded', 'existing text'],
    balanced_insertions: ['insertion', '{++', '++}'],
    balanced_deletions: ['deletion', '{--', '--}'],
    balanced_substitutions: ['substitution', '{~~', '~~}', '~>'],
    heading_newlines: ['newline', 'heading'],
    criticmarkup_heading_format: ['CriticMarkup', 'heading', 'format'],
  };

  const patterns = issuePatterns[checkId] || [];
  const hasRelatedIssue = issues.some(issue =>
    patterns.some(pattern => issue.toLowerCase().includes(pattern.toLowerCase()))
  );

  return hasRelatedIssue ? 'failed' : 'passed';
}

export function ValidationSummaryDashboard({ results, step4Result }: ValidationSummaryDashboardProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const steps = [
    {
      key: 'step2',
      label: 'Step 2: Apply Suggestions',
      result: results.step2,
      checks: STEP_CHECKS.step2,
    },
    {
      key: 'step3',
      label: 'Step 3: Generate Diff',
      result: results.step3,
      checks: STEP_CHECKS.step3,
    },
    {
      key: 'step4',
      label: 'Step 4: Preprocess',
      result: step4Result,
      checks: STEP_CHECKS.step4,
    },
  ];

  const runSteps = steps.filter((s) => s.result);
  const hasErrors = runSteps.some((s) => s.result && !s.result.valid && s.result.severity === 'error');
  const hasWarnings = runSteps.some((s) => s.result && !s.result.valid && s.result.severity === 'warning');
  const allPassed = runSteps.length > 0 && runSteps.every((s) => s.result?.valid);

  if (runSteps.length === 0) {
    return null;
  }

  const getDashboardClasses = () => {
    if (hasErrors) return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    if (hasWarnings) return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    if (allPassed) return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
    return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  };

  const getStepClasses = (result?: ValidationResult) => {
    if (!result) return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600';
    if (result.valid) return 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 hover:bg-green-200 dark:hover:bg-green-900/50';
    if (result.severity === 'error') return 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 hover:bg-red-200 dark:hover:bg-red-900/50';
    return 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-200 dark:hover:bg-yellow-900/50';
  };

  const getIcon = (result?: ValidationResult) => {
    if (!result) return '—';
    if (result.valid) return '✓';
    if (result.severity === 'error') return '✗';
    return '⚠';
  };

  const getCheckIcon = (status: 'passed' | 'failed' | 'unknown') => {
    if (status === 'passed') return '✓';
    if (status === 'failed') return '✗';
    return '?';
  };

  const getCheckClasses = (status: 'passed' | 'failed' | 'unknown') => {
    if (status === 'passed') return 'text-green-600 dark:text-green-400';
    if (status === 'failed') return 'text-red-600 dark:text-red-400';
    return 'text-gray-500 dark:text-gray-400';
  };

  return (
    <div className={`max-w-4xl mx-auto rounded-lg border p-4 mb-6 ${getDashboardClasses()}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Pipeline Validation Summary
        </h3>
        <div className="flex items-center gap-2">
          {hasErrors && (
            <span className="px-2 py-1 bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 rounded text-sm font-medium">
              {runSteps.filter((s) => s.result?.severity === 'error' && !s.result?.valid).length} Error(s)
            </span>
          )}
          {hasWarnings && (
            <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 rounded text-sm font-medium">
              {runSteps.filter((s) => s.result?.severity === 'warning' && !s.result?.valid).length} Warning(s)
            </span>
          )}
          {allPassed && (
            <span className="px-2 py-1 bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 rounded text-sm font-medium">
              All Passed ✓
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {steps.map(({ key, label, result, checks }) => (
          <div
            key={key}
            className={`p-3 rounded-md cursor-pointer transition-all border ${getStepClasses(result)}`}
            onClick={() => result && setExpandedStep(expandedStep === key ? null : key)}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{label}</span>
              <span className="text-lg">{getIcon(result)}</span>
            </div>

            {!result && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Not yet run</p>
            )}

            {expandedStep === key && result && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 space-y-3">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Checks performed ({checks.length}):
                </p>

                {checks.map((check) => {
                  const status = getCheckStatus(key, check.id, result.issues);
                  return (
                    <div key={check.id} className="bg-white/50 dark:bg-gray-800/50 rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-sm font-medium ${getCheckClasses(status)}`}>
                          {getCheckIcon(status)}
                        </span>
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                          {check.name}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          status === 'passed'
                            ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
                            : 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                        }`}>
                          {status === 'passed' ? 'PASSED' : 'FAILED'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                        {check.description}
                      </p>
                    </div>
                  );
                })}

                {result.issues.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                    <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">
                      Issues found:
                    </p>
                    <ul className="text-xs space-y-1">
                      {result.issues.map((issue, idx) => (
                        <li key={idx} className="text-red-600 dark:text-red-400">
                          • {issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 text-center">
        Click a step to see detailed check information
      </p>
    </div>
  );
}
