/** AVA Story Record — the citizen-model square (brief §6).
 *
 *  `dialog.state` is computed, never asserted. Two axes:
 *
 *      instrumented evidence present?      (verified data on the phenomenon)
 *      expected behaviour present?         (the model reproduces / expects it)
 *
 *      confirmed        both yes, residual within tolerance
 *      blind_spot       evidence yes, model no    the model misses a reported problem
 *      silent_problem   model yes, nothing reported  agents drop activities nobody reports
 *      normal           both no
 *
 *  `dialog.model_check` carries { run_id, baseline_id, expected, observed,
 *  residual, tolerance } so a reader can recompute the quadrant instead of
 *  trusting the label: `squareState` recomputes the residual from
 *  expected/observed and does not trust the stored one. */

import type { DialogState, StoryRecord } from './types.ts'

export interface SquareEvidence {
  /** Verified instrumented / corroborated evidence on the phenomenon. */
  instrumented: boolean
  /** A citizen reported the phenomenon (critical_functional.present). */
  reported: boolean
  /** Model expectation when a run/baseline exists; null when none. */
  model: SquareModelCheck | null
}

export interface SquareModelCheck {
  run_id: string
  baseline_id: string
  expected: number
  observed: number
  tolerance: number
}

export interface SquareResult {
  state: DialogState
  model_check: SquareModelCheck & { residual: number } | null
}

/** Pure quadrant computation. When both evidence and model are present the
 *  residual is recomputed; if it exceeds tolerance the model is missing the
 *  reported magnitude → blind_spot. Evidence without a model run cannot
 *  land in a quadrant yet → pending (fail-closed, never guessed). */
export function squareState(evidence: SquareEvidence): SquareResult {
  const hasEvidence = Boolean(evidence.instrumented) || Boolean(evidence.reported)
  // defensive: a JS caller may pass undefined — fail closed, never crash.
  const model = (evidence.model ?? null) as SquareModelCheck | null
  const modelYes = model !== null && typeof model.expected === 'number' && model.expected > 0

  if (hasEvidence && model === null) return { state: 'pending', model_check: null }
  if (hasEvidence && modelYes && model) {
    const { expected, observed } = model
    const residual = observed - expected
    const within = Math.abs(residual) <= model.tolerance
    return {
      state: within ? 'confirmed' : 'blind_spot',
      model_check: { ...model, residual },
    }
  }
  if (hasEvidence && !modelYes && model) return { state: 'blind_spot', model_check: { ...model, residual: model.observed - model.expected } }
  if (!hasEvidence && modelYes && model) {
    return { state: 'silent_problem', model_check: { ...model, residual: model.observed - model.expected } }
  }
  // nothing reported/instrumented and the model does nothing: normality.
  return { state: 'normal', model_check: model ? { ...model, residual: model.observed - model.expected } : null }
}

/** Stub evidence reader: derives the square evidence from a record when no
 *  external evidence file is provided. Deterministic rules:
 *  - instrumented: trust_level A (instrumented) or B (operator feed), or at
 *    least one independent corroboration;
 *  - reported: the critical-functional channel is present;
 *  - model: null (the record alone cannot fabricate a model expectation —
 *    fail-closed; pass real numbers via the evidence reader/CLI). */
export function evidenceFromRecord(record: StoryRecord): SquareEvidence {
  const instrumented =
    record.routing.trust_level === 'A' || record.routing.trust_level === 'B' || record.links.corroborating >= 1
  return {
    instrumented,
    reported: record.channels.critical_functional.present,
    model: null,
  }
}

/** Build the `dialog` block from evidence directly (used by the emit path
 *  before the record exists). */
export function dialogBlock(evidence: SquareEvidence): { state: DialogState, model_check: SquareModelCheck & { residual: number } | null } {
  const result = squareState(evidence)
  return { state: result.state, model_check: result.model_check }
}
