'use client';

import { PipelineValidationResults, VALIDATION_DESCRIPTIONS, ValidationResult } from '@/editorFiles/validation/pipelineValidation';
import { useState } from 'react';

interface ValidationSummaryDashboardProps {
  results: PipelineValidationResults;
  step4Result?: ValidationResult;
}

interface StepConfig {
  key: string;
  label: string;
  result?: ValidationResult & { description: string };
  description: string;
}

export function ValidationSummaryDashboard({ results, step4Result }: ValidationSummaryDashboardProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const steps: StepConfig[] = [
    {
      key: 'step2',
      label: 'Step 2: Apply Suggestions',
      result: results.step2,
      description: VALIDATION_DESCRIPTIONS.step2,
    },
    {
      key: 'step3',
      label: 'Step 3: Generate Diff',
      result: results.step3,
      description: VALIDATION_DESCRIPTIONS.step3,
    },
    {
      key: 'step4',
      label: 'Step 4: Preprocess',
      result: step4Result ? { ...step4Result, description: VALIDATION_DESCRIPTIONS.step4 } : undefined,
      description: VALIDATION_DESCRIPTIONS.step4,
    },
  ];

  const runSteps = steps.filter((s) => s.result);
  const hasErrors = runSteps.some((s) => s.result && !s.result.valid && s.result.severity === 'error');
  const hasWarnings = runSteps.some((s) => s.result && !s.result.valid && s.result.severity === 'warning');
  const allPassed = runSteps.length > 0 && runSteps.every((s) => s.result?.valid);

  if (runSteps.length === 0) {
    return null; // Don't show dashboard if no validations have run
  }

  const getDashboardClasses = () => {
    if (hasErrors) {
      return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    }
    if (hasWarnings) {
      return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    }
    if (allPassed) {
      return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
    }
    return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  };

  const getStepClasses = (result?: ValidationResult) => {
    if (!result) {
      return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600';
    }
    if (result.valid) {
      return 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 hover:bg-green-150 dark:hover:bg-green-900/50';
    }
    if (result.severity === 'error') {
      return 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 hover:bg-red-150 dark:hover:bg-red-900/50';
    }
    return 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-150 dark:hover:bg-yellow-900/50';
  };

  const getIcon = (result?: ValidationResult) => {
    if (!result) return '\u2014'; // em dash
    if (result.valid) return '\u2713'; // checkmark
    if (result.severity === 'error') return '\u2717'; // X
    return '\u26A0'; // warning
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
              All Passed \u2713
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {steps.map(({ key, label, result, description }) => (
          <div
            key={key}
            className={`p-3 rounded-md cursor-pointer transition-all border ${getStepClasses(result)}`}
            onClick={() => result && setExpandedStep(expandedStep === key ? null : key)}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{label}</span>
              <span className="text-lg">{getIcon(result)}</span>
            </div>
            {expandedStep === key && result && (
              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 italic">{description}</p>
                {result.issues.length > 0 ? (
                  <ul className="text-xs space-y-1">
                    {result.issues.map((issue, idx) => (
                      <li key={idx} className="text-gray-700 dark:text-gray-300">
                        \u2022 {issue}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-green-700 dark:text-green-400">All checks passed</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
