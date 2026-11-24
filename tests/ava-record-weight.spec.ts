import { describe, expect, it } from 'vitest'
import { emitRecord } from '../src/city-life-telling/ava_record/emit.ts'
import { FIXTURE_NOW, FIXTURE_PROFILES, syntheticEmitInput } from '../src/city-life-telling/ava_record/corpus.ts'
import {
  CLASS_CLOCK, HALF_LIFE_HOURS, TRUST_WEIGHT,
  applyRecord, checkClock, checkOverride, computeWeight, recordWeight,
} from '../src/city-life-telling/ava_record/weight.ts'
import type { StoryRecord } from '../src/city-life-telling/ava_record/types.ts'

function firstRecord(): StoryRecord {
  const result = emitRecord(syntheticEmitInput(0, FIXTURE_PROFILES.request_311, FIXTURE_NOW))
  if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
  return result.record
}

describe('the class tables (brief §2)', () => {
  it('half-lives match the brief', () => {
    expect(HALF_LIFE_HOURS.theta_OD).toBe(24)
    expect(HALF_LIFE_HOURS.theta_cap).toBe(72)
    expect(HALF_LIFE_HOURS.theta_evt).toBe(6)
    expect(HALF_LIFE_HOURS.theta_beh).toBe(90 * 24)
    expect(HALF_LIFE_HOURS.theta_pers).toBe(365 * 24)
    expect(HALF_LIFE_HOURS.theta_perc).toBe(180 * 24)
  })

  it('trust weights match the brief', () => {
    expect(TRUST_WEIGHT).toEqual({ A: 1.0, B: 0.8, C: 0.5, D: 0.3, E: 0.1 })
  })

  it('minute classes are the traffic, month classes are the people', () => {
    expect(CLASS_CLOCK.theta_OD).toBe('minute')
    expect(CLASS_CLOCK.theta_cap).toBe('minute')
    expect(CLASS_CLOCK.theta_evt).toBe('minute')
    expect(CLASS_CLOCK.theta_beh).toBe('month')
    expect(CLASS_CLOCK.theta_pers).toBe('month')
    expect(CLASS_CLOCK.theta_perc).toBe('month')
  })
})

describe('I8 — decay', () => {
  it('w is strictly decreasing in age and bounded in [0,1]', () => {
    const observedAt = '2026-11-10T13:20:00Z'
    for (const cls of Object.keys(HALF_LIFE_HOURS) as Array<keyof typeof HALF_LIFE_HOURS>) {
      let previous = Number.POSITIVE_INFINITY
      for (let hours = 0; hours <= 24 * 30; hours += 3) {
        const now = new Date(Date.parse(observedAt) + hours * 3_600_000).toISOString()
        const { weight } = computeWeight(0.9, 'C', observedAt, HALF_LIFE_HOURS[cls], now)
        expect(weight).toBeGreaterThanOrEqual(0)
        expect(weight).toBeLessThanOrEqual(1)
        expect(weight).toBeLessThan(previous + 1e-9) // strictly decreasing
        previous = weight
      }
    }
  })

  it('w(0 half-lives) = confidence * trust, rounded to 4 decimals', () => {
    const { weight } = computeWeight(0.63, 'D', '2026-11-16T13:20:00Z', 72, '2026-11-16T13:20:00Z')
    expect(weight).toBe(Math.round(0.63 * 0.3 * 10000) / 10000)
  })

  it('one half-life of age halves the weight', () => {
    const at0 = computeWeight(1.0, 'A', '2026-11-16T13:20:00Z', 24, '2026-11-16T13:20:00Z')
    const at24 = computeWeight(1.0, 'A', '2026-11-16T13:20:00Z', 24, '2026-11-17T13:20:00Z')
    expect(at24.weight).toBe(0.5)
    expect(at0.weight).toBe(1)
  })

  it('future observations get no decay bonus (age floored at 0)', () => {
    const w = computeWeight(0.5, 'C', '2026-11-16T13:20:00Z', 24, '2026-11-15T13:20:00Z')
    expect(w.weight).toBe(0.25) // 0.5 confidence * 0.5 trust C, no decay bonus
    expect(w.age_hours).toBe(0)
  })
})

describe('I6 — clock discipline', () => {
  const monthRecord = { ...firstRecord(), routing: { ...firstRecord().routing, parameter_class: 'theta_perc' } } as StoryRecord

  it('a monthly class cannot be applied to a minute-clock run', () => {
    const record = monthRecord
    expect(CLASS_CLOCK[record.routing.parameter_class]).toBe('month')
    const result = applyRecord(record, 'minute', FIXTURE_NOW)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.code).toBe('clock_mismatch')
  })

  it('a minute class cannot inform a month run either (fail-closed)', () => {
    const result = checkClock(firstRecord(), 'month')
    expect(result.ok).toBe(false)
  })

  it('matching clocks pass', () => {
    expect(checkClock(monthRecord, 'month').ok).toBe(true)
    expect(checkClock(firstRecord(), 'minute').ok).toBe(true)
  })

  it('applyRecord refuses non-eligible records regardless of clock', () => {
    const record = firstRecord()
    const notEligible = {
      ...record,
      routing: { ...record.routing, calibration_eligible: false },
    } as StoryRecord
    const result = applyRecord(notEligible, 'minute', FIXTURE_NOW)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.code).toBe('not_eligible')
  })
})

describe('I7 — the override rule that never bends', () => {
  it('a D/E record with override = true is rejected', () => {
    for (const level of ['D', 'E'] as const) {
      const record = firstRecord()
      record.routing.trust_level = level
      record.routing.override = true
      expect(checkOverride(record).ok).toBe(false)
    }
  })

  it('A/B/C with override = true is accepted', () => {
    for (const level of ['A', 'B', 'C'] as const) {
      const record = firstRecord()
      record.routing.trust_level = level
      record.routing.override = true
      expect(checkOverride(record).ok).toBe(true)
    }
  })

  it('the emit path never sets override for D/E records', () => {
    for (const [kind, level] of [['request_311', 'D'], ['assisted_story', 'E']] as const) {
      const result = emitRecord(syntheticEmitInput(kind === 'request_311' ? 0 : 1, FIXTURE_PROFILES[kind], FIXTURE_NOW))
      if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
      expect(result.record.routing.trust_level).toBe(level)
      expect(result.record.routing.override).toBe(false)
    }
  })

  it('applyRecord rejects an override violation with its own code', () => {
    const record = firstRecord()
    record.routing.trust_level = 'E'
    record.routing.override = true
    const result = applyRecord(record, 'minute', FIXTURE_NOW)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.code).toBe('override')
  })
})

describe('the stored weight', () => {
  it('observation.weight equals the pure weight at emit time', () => {
    const record = firstRecord()
    const breakdown = recordWeight(record, record.created_at)
    expect(record.observation.weight).toBe(breakdown.weight)
    expect(record.observation.decay.half_life_hours).toBe(HALF_LIFE_HOURS[record.routing.parameter_class])
    expect(record.observation.decay.computed_at).toBe(record.created_at)
  })

  it('weight rounds to 4 decimals', () => {
    const w = computeWeight(0.7777, 'B', '2026-11-16T13:20:00Z', 6, '2026-11-16T14:20:00Z')
    expect(Number(w.weight.toFixed(4))).toBe(w.weight)
  })
})
