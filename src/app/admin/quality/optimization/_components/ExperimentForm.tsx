'use client';
/**
 * Experiment creation form with factor selection, validation preview, and launch button.
 * Fetches factor metadata from server and provides real-time validation feedback.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  validateExperimentConfigAction,
  startExperimentAction,
  getFactorMetadataAction,
} from '@evolution/services/experimentActions';
import type { FactorMetadata } from '@evolution/services/experimentActions';
import { getPromptsAction } from '@evolution/services/promptRegistryActions';
import type { PromptMetadata } from '@evolution/lib/types';

interface FactorState {
  enabled: boolean;
  low: string | number;
  high: string | number;
}

interface ValidationPreview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  expandedRunCount: number;
  estimatedCost: number;
}

interface ExperimentFormProps {
  onStarted?: (experimentId: string) => void;
}

/** Format pricing as a compact label for dropdown options. */
function formatPricing(pricing: { inputPer1M: number; outputPer1M: number }): string {
  const fmt = (n: number) => n < 1 ? `$${n.toFixed(2)}` : `$${n}`;
  return `${fmt(pricing.inputPer1M)}/${fmt(pricing.outputPer1M)}`;
}

interface FactorValueSelectProps {
  label: string;
  value: string | number;
  validValues: (string | number)[];
  factorType: string;
  valuePricing?: Record<string, { inputPer1M: number; outputPer1M: number }>;
  onChange: (value: string | number) => void;
}

/** Dropdown for selecting a factor's low or high value. */
function FactorValueSelect({
  label,
  value,
  validValues,
  factorType,
  valuePricing,
  onChange,
}: FactorValueSelectProps): JSX.Element {
  return (
    <>
      <label className="text-xs font-ui text-[var(--text-muted)]">{label}:</label>
      <select
        value={String(value)}
        onChange={(e) => {
          const val = factorType === 'integer' ? Number(e.target.value) : e.target.value;
          onChange(val);
        }}
        className="px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
      >
        {validValues.map((v) => {
          const pricing = valuePricing?.[String(v)];
          const optionLabel = pricing
            ? `${String(v)} (${formatPricing(pricing)})`
            : String(v);
          return (
            <option key={String(v)} value={String(v)}>{optionLabel}</option>
          );
        })}
      </select>
    </>
  );
}

export function ExperimentForm({ onStarted }: ExperimentFormProps): JSX.Element {
  const [factorMeta, setFactorMeta] = useState<FactorMetadata[]>([]);
  const [factorStates, setFactorStates] = useState<Record<string, FactorState>>({});
  const [metaLoading, setMetaLoading] = useState(true);

  const [name, setName] = useState('');
  const [availablePrompts, setAvailablePrompts] = useState<PromptMetadata[]>([]);
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [budget, setBudget] = useState(50);
  const [target, setTarget] = useState<'elo' | 'elo_per_dollar'>('elo');
  const [maxRounds, setMaxRounds] = useState(5);

  const [validation, setValidation] = useState<ValidationPreview | null>(null);
  const [validating, setValidating] = useState(false);
  const [starting, setStarting] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load factor metadata and prompts on mount
  useEffect(() => {
    (async () => {
      const [factorResult, promptResult] = await Promise.all([
        getFactorMetadataAction(),
        getPromptsAction({ status: 'active' }),
      ]);
      if (factorResult.success && factorResult.data) {
        setFactorMeta(factorResult.data);
        const initial: Record<string, FactorState> = {};
        for (const f of factorResult.data) {
          const values = f.validValues;
          initial[f.key] = {
            enabled: false,
            low: values[0] ?? '',
            high: values[values.length - 1] ?? '',
          };
        }
        setFactorStates(initial);
      }
      if (promptResult.success && promptResult.data) {
        setAvailablePrompts(promptResult.data);
      }
      setMetaLoading(false);
    })();
  }, []);

  // Derived values
  const enabledFactors = Object.entries(factorStates).filter(([, s]) => s.enabled);

  // Client-side fast-fail
  const clientErrors: string[] = [];
  if (enabledFactors.length < 2) clientErrors.push('Select at least 2 factors');
  if (selectedPromptIds.length === 0) clientErrors.push('Select at least 1 prompt');
  if (budget < 0.01) clientErrors.push('Budget must be >= $0.01');
  for (const [key, state] of enabledFactors) {
    if (String(state.low) === String(state.high)) {
      clientErrors.push(`${key}: low and high are identical`);
    }
  }

  // Derived factor map from enabled factors
  const factorMap: Record<string, { low: string | number; high: string | number }> =
    Object.fromEntries(enabledFactors.map(([key, s]) => [key, { low: s.low, high: s.high }]));

  // Debounced server validation
  const runValidation = useCallback(async () => {
    if (clientErrors.length > 0 || enabledFactors.length < 2) {
      setValidation(null);
      return;
    }

    setValidating(true);
    const result = await validateExperimentConfigAction({
      factors: factorMap,
      promptIds: selectedPromptIds,
    });
    if (result.success && result.data) {
      setValidation(result.data);
    }
    setValidating(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(enabledFactors), JSON.stringify(selectedPromptIds)]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runValidation, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [runValidation]);

  const handleStart = async () => {
    if (clientErrors.length > 0) return;
    if (!name.trim()) {
      toast.error('Enter an experiment name');
      return;
    }

    setStarting(true);
    const result = await startExperimentAction({
      name: name.trim(),
      factors: factorMap,
      promptIds: selectedPromptIds,
      budget,
      target,
      maxRounds,
    });

    if (result.success && result.data) {
      toast.success(`Experiment started: ${result.data.experimentId}`);
      onStarted?.(result.data.experimentId);
    } else {
      toast.error(result.error?.message ?? 'Failed to start experiment');
    }
    setStarting(false);
  };

  const updateFactor = (key: string, updates: Partial<FactorState>) => {
    setFactorStates(prev => ({
      ...prev,
      [key]: { ...prev[key], ...updates },
    }));
  };

  if (metaLoading) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardContent className="p-8">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
            <span className="font-ui">Loading factors...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader>
        <CardTitle className="text-xl font-display text-[var(--text-primary)]">
          New Experiment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-ui font-medium text-[var(--text-secondary)] mb-1">
            Experiment Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Model comparison Q1"
            className="w-full px-3 py-2 text-sm font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-gold)] focus:outline-none"
          />
        </div>

        {/* Factors */}
        <div>
          <label className="block text-sm font-ui font-medium text-[var(--text-secondary)] mb-2">
            Factors (select 2-7)
          </label>
          <div className="space-y-3">
            {factorMeta.map((factor) => {
              const state = factorStates[factor.key];
              if (!state) return null;
              return (
                <div
                  key={factor.key}
                  className={`p-3 border rounded-page transition-colors ${
                    state.enabled
                      ? 'border-[var(--accent-gold)] bg-[var(--surface-elevated)]'
                      : 'border-[var(--border-default)] bg-[var(--surface-primary)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={state.enabled}
                      onChange={(e) => updateFactor(factor.key, { enabled: e.target.checked })}
                      className="w-4 h-4 accent-[var(--accent-gold)]"
                    />
                    <span className="text-sm font-ui font-medium text-[var(--text-primary)] min-w-[140px]">
                      {factor.label}
                    </span>
                    {state.enabled && (
                      <div className="flex items-center gap-2 flex-1">
                        <FactorValueSelect
                          label="Low"
                          value={state.low}
                          validValues={factor.validValues}
                          factorType={factor.type}
                          valuePricing={factor.valuePricing}
                          onChange={(val) => updateFactor(factor.key, { low: val })}
                        />
                        <FactorValueSelect
                          label="High"
                          value={state.high}
                          validValues={factor.validValues}
                          factorType={factor.type}
                          valuePricing={factor.valuePricing}
                          onChange={(val) => updateFactor(factor.key, { high: val })}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Prompts */}
        <div>
          <label className="block text-sm font-ui font-medium text-[var(--text-secondary)] mb-2">
            Prompts (select 1-10 from library)
          </label>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {availablePrompts.length === 0 ? (
              <p className="text-xs font-ui text-[var(--text-muted)] py-3 text-center">
                No active prompts in library
              </p>
            ) : (
              availablePrompts.map((p) => {
                const isSelected = selectedPromptIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-start gap-3 p-3 border rounded-page cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-[var(--accent-gold)] bg-[var(--surface-elevated)]'
                        : 'border-[var(--border-default)] bg-[var(--surface-primary)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedPromptIds(prev =>
                          isSelected
                            ? prev.filter(id => id !== p.id)
                            : [...prev, p.id],
                        );
                      }}
                      className="w-4 h-4 mt-0.5 accent-[var(--accent-gold)]"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-ui font-medium text-[var(--text-primary)]">
                        {p.title}
                      </span>
                      <span className="text-xs font-body text-[var(--text-muted)] ml-2 truncate">
                        — {p.prompt.length > 80 ? p.prompt.slice(0, 80) + '...' : p.prompt}
                      </span>
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs font-ui text-[var(--text-muted)] mt-1">
            {selectedPromptIds.length} of {availablePrompts.length} selected
          </p>
        </div>

        {/* Settings row */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-ui font-medium text-[var(--text-secondary)] mb-1">
              Total Budget ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              min={0.01}
              className="w-full px-3 py-2 text-sm font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-ui font-medium text-[var(--text-secondary)] mb-1">
              Optimize
            </label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as 'elo' | 'elo_per_dollar')}
              className="w-full px-3 py-2 text-sm font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
            >
              <option value="elo">Max Rating</option>
              <option value="elo_per_dollar">Rating per Dollar</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-ui font-medium text-[var(--text-secondary)] mb-1">
              Max Rounds
            </label>
            <input
              type="number"
              value={maxRounds}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
              min={1}
              max={10}
              className="w-full px-3 py-2 text-sm font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
            />
          </div>
        </div>

        {/* Validation preview */}
        {(clientErrors.length > 0 || validation || validating) && (
          <div className="p-3 border border-[var(--border-default)] rounded-page bg-[var(--surface-primary)]">
            <div className="text-xs font-ui font-medium text-[var(--text-muted)] mb-1">
              Validation Preview
              {validating && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <span className="w-3 h-3 border border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
                  Checking...
                </span>
              )}
              <button
                onClick={() => runValidation()}
                disabled={validating || clientErrors.length > 0}
                className="text-xs text-[var(--accent-gold)] hover:underline ml-2 disabled:opacity-50"
              >
                {validating ? 'Refreshing...' : '\u21BB Refresh'}
              </button>
            </div>
            {clientErrors.length > 0 && (
              <ul className="text-xs font-body text-[var(--status-error)] space-y-0.5">
                {clientErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            {validation && clientErrors.length === 0 && (
              <div className="space-y-1">
                {validation.errors.length > 0 && (
                  <ul className="text-xs font-body text-[var(--status-error)] space-y-0.5">
                    {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
                {validation.warnings.length > 0 && (
                  <ul className="text-xs font-body text-[var(--accent-gold)] space-y-0.5">
                    {validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
                {validation.valid && (
                  <div className="text-xs font-body text-[var(--status-success)]">
                    {validation.expandedRunCount} runs | Est. ${validation.estimatedCost.toFixed(2)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Start button */}
        <button
          onClick={handleStart}
          disabled={clientErrors.length > 0 || starting || (validation !== null && !validation.valid)}
          className="w-full py-2.5 font-ui text-sm font-medium bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {starting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-[var(--surface-primary)] border-t-transparent rounded-full animate-spin" />
              Starting...
            </span>
          ) : (
            'Start Experiment'
          )}
        </button>
      </CardContent>
    </Card>
  );
}
