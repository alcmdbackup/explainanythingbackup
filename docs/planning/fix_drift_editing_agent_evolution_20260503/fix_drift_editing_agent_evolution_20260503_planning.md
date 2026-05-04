# fix_drift_editing_agent_evolution_20260503 Plan

## Background

In the latest evolution run, all `iterative_editing` agent invocations seem to have encountered major drift. The Implementer pre-check (parser → strip-markup → drift check) is the deterministic gate that classifies a Proposer cycle's drift severity; "major drift" causes the cycle to abort cleanly rather than fall through to the drift-recovery LLM (which only handles minor drift). If every invocation is hitting major drift, no edits are landing, the editing iteration produces no variants, and `iterative_edit_drift_rate` is at 1.0.

## Problem

Need to (a) confirm whether this is genuinely a major-drift failure mode vs. a misclassification (e.g. parser regression, drift-detector false positive, or the strip-markup pass diverging from the unmodified parent), (b) identify the root cause from invocation `execution_detail.cycles[]` data plus `evolution_logs` rows, and (c) propose a fix or kill-switch path. Candidate hypotheses: Proposer outputting more than the body verbatim (extra preamble/conclusion), CriticMarkup syntax drift, hard-rule/size-ratio guardrail tripping every group, or a recent change to the drift-detector thresholds.
