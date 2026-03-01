// Report tab: displays auto-generated LLM analysis with optional regeneration.
// Reads cached report from resultsSummary.report, with manual regenerate fallback.

'use client';

import { useState } from 'react';
import { regenerateExperimentReportAction } from '@evolution/services/experimentActions';

const TERMINAL_STATES = new Set(['converged', 'budget_exhausted', 'max_rounds', 'failed', 'cancelled']);

interface ReportTabProps {
  experimentId: string;
  status: string;
  resultsSummary: Record<string, unknown> | null;
}

export function ReportTab({ experimentId, status, resultsSummary }: ReportTabProps) {
  const cachedReport = resultsSummary?.report as {
    text?: string;
    generatedAt?: string;
    model?: string;
  } | undefined;

  const [reportText, setReportText] = useState<string | null>(cachedReport?.text ?? null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(cachedReport?.generatedAt ?? null);
  const [model, setModel] = useState<string | null>(cachedReport?.model ?? null);
  const [loading, setLoading] = useState(false);

  const isTerminal = TERMINAL_STATES.has(status);

  const handleGenerate = async () => {
    setLoading(true);
    const result = await regenerateExperimentReportAction({ experimentId });
    if (result.success && result.data) {
      setReportText(result.data.report);
      setGeneratedAt(result.data.generatedAt);
      setModel(result.data.model);
    }
    setLoading(false);
  };

  // No report and not terminal — experiment still running
  if (!reportText && !isTerminal) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm font-body text-[var(--text-muted)]">
          Report will be generated when the experiment completes.
        </p>
      </div>
    );
  }

  // No report but terminal — generation failed or pre-existing experiment
  if (!reportText && isTerminal) {
    return (
      <div className="py-8 text-center space-y-3">
        <p className="text-sm font-body text-[var(--text-muted)]">
          No report available. Click below to generate one.
        </p>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="px-4 py-2 text-sm font-ui border border-[var(--accent-gold)] text-[var(--accent-gold)] rounded-page hover:bg-[var(--accent-gold)]/10 disabled:opacity-50 transition-colors"
          data-testid="generate-report-button"
        >
          {loading ? 'Generating...' : 'Generate Report'}
        </button>
      </div>
    );
  }

  // Render report sections (split on ## headers)
  const sections = (reportText ?? '').split(/^## /m).filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Report content */}
      <div className="space-y-4" data-testid="report-content">
        {sections.map((section, i) => {
          const lines = section.split('\n');
          const title = lines[0]?.trim();
          const body = lines.slice(1).join('\n').trim();
          return (
            <div key={i} className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page p-4">
              {title && (
                <h3 className="text-base font-display font-medium text-[var(--text-primary)] mb-2">
                  {title}
                </h3>
              )}
              {body && (
                <div className="text-sm font-body text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                  {body}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Metadata + regenerate */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-default)]">
        <div className="text-[10px] font-mono text-[var(--text-muted)]" data-testid="report-metadata">
          {model && <span>Model: {model}</span>}
          {generatedAt && (
            <span className="ml-3">
              Generated: {new Date(generatedAt).toLocaleString()}
            </span>
          )}
        </div>
        {isTerminal && (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-3 py-1 text-xs font-ui border border-[var(--border-default)] text-[var(--text-secondary)] rounded-page hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Regenerating...' : 'Regenerate'}
          </button>
        )}
      </div>
    </div>
  );
}
