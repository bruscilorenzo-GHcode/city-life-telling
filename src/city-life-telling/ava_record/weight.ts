/** AVA Story Record — weight and decay (brief §5) plus clock discipline
 *  (I6) and the never-bending override rule (I7).
 *
 *      w(t) = confidence * trust_weight(level) * 0.5 ^ ((t - observed_at) / half_life_hours)
 *
 *  - half-life per class (hard clock constraint, brief §2);
 *  - `w` clamped to [0,1], rounded to 4 decimals;
 *  - records decay towards zero and are never deleted;
 *  - a D/E record may raise an estimate or flag a gap, never lower an
 *    instrumented estimate: `override = false`, and any record carrying
 *    `override = true` with level D/E is rejected. */

import type { ParameterClass, RecordClock, StoryRecord, TrustLevel } from './types.ts'

/** Default half-lives in hours (brief §2). Overridable per record, never
 *  shortened below the class default without a note in review_notes. */
export const HALF_LIFE_HOURS: Record<ParameterClass, number> = {
  theta_OD: 24,
  theta_cap: 72,
  theta_evt: 6,
  theta_beh: 90 * 24,
  theta_pers: 365 * 24,
  theta_perc: 180 * 24,
}

/** Trust weights (brief §4). */
export const TRUST_WEIGHT: Record<TrustLevel, number> = {
  A: 1.0,
  B: 0.8,
  C: 0.5,
  D: 0.3,
  E: 0.1,
}

/** Class clock (brief §2): minute classes are the traffic, month classes
 *  are the people. */
export const CLASS_CLOCK: Record<ParameterClass, 'minute' | 'month'> = {
  theta_OD: 'minute',
  theta_cap: 'minute',
  theta_evt: 'minute',
  theta_beh: 'month',
  theta_pers: 'month',
  theta_perc: 'month',
}

/** Clock granularity a run moves on. */
export type RunClock = RecordClock

const HOUR_MS = 3_600_000

function parseIso(iso: string): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`invalid date-time: ${iso}`)
  return t
}

const round4 = (n: number) => Math.round(n * 10000) / 10000
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export interface WeightBreakdown {
  /** w(t) clamped to [0,1], 4 decimals. */
  weight: number
  confidence: number
  trust_weight: number
  /** age in hours, floored at 0 (no decay bonus for future observations). */
  age_hours: number
  half_life_hours: number
  decay_factor: number
}

/** Pure weight computation from primitives (used by the emit path before
 *  the record object exists). */
export function computeWeight(
  confidence: number,
  trustLevel: TrustLevel,
  observedAt: string,
  halfLifeHours: number,
  now: string,
): WeightBreakdown {
  if (!(halfLifeHours > 0)) throw new Error('half_life_hours must be > 0')
  const trust = TRUST_WEIGHT[trustLevel]
  const ageHours = Math.max(0, (parseIso(now) - parseIso(observedAt)) / HOUR_MS)
  const decayFactor = Math.pow(0.5, ageHours / halfLifeHours)
  return {
    weight: round4(clamp01(confidence * trust * decayFactor)),
    confidence,
    trust_weight: trust,
    age_hours: round4(ageHours),
    half_life_hours: halfLifeHours,
    decay_factor: round4(decayFactor),
  }
}

/** Pure weight computation for one record at time `now` (ISO date-time). */
export function recordWeight(record: StoryRecord, now: string): WeightBreakdown {
  return computeWeight(
    record.routing.confidence,
    record.routing.trust_level,
    record.time.observed_at,
    record.observation.decay.half_life_hours,
    now,
  )
}

/** I6 — clock discipline: a record landing in a `month` class cannot be
 *  applied to a run that moves on a `minute` clock (and a minute class
 *  cannot inform a month run). Fail-closed on any mismatch. */
export function checkClock(record: StoryRecord, runClock: RunClock): { ok: true } | { ok: false, reason: string } {
  const classClock = CLASS_CLOCK[record.routing.parameter_class]
  const mismatch =
    (classClock === 'month' && runClock === 'minute') ||
    (classClock === 'minute' && runClock === 'month')
  return mismatch
    ? { ok: false, reason: `clock mismatch: ${record.routing.parameter_class} runs on a ${classClock} clock, the run moves on a ${runClock} clock` }
    : { ok: true }
}

/** I7 — the rule that never bends: level D/E with override = true is
 *  rejected. */
export function checkOverride(record: StoryRecord): { ok: true } | { ok: false, reason: string } {
  const weak = record.routing.trust_level === 'D' || record.routing.trust_level === 'E'
  return weak && record.routing.override === true
    ? { ok: false, reason: `trust_level ${record.routing.trust_level} may never set override = true` }
    : { ok: true }
}

export type ApplyResult =
  | { ok: true, weight: number }
  | { ok: false, reason: string, code: 'clock_mismatch' | 'not_eligible' | 'override' }

/** apply(record, run): the calibration gate. A record enters a run only
 *  when consented, eligible, clock-compatible and override-clean. */
export function applyRecord(record: StoryRecord, runClock: RunClock, now: string): ApplyResult {
  if (!record.routing.calibration_eligible) {
    return { ok: false, reason: 'record is not calibration-eligible', code: 'not_eligible' }
  }
  const clock = checkClock(record, runClock)
  if (!clock.ok) return { ok: false, reason: clock.reason, code: 'clock_mismatch' }
  const override = checkOverride(record)
  if (!override.ok) return { ok: false, reason: override.reason, code: 'override' }
  return { ok: true, weight: recordWeight(record, now).weight }
}
