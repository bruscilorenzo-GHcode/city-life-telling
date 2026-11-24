import { describe, expect, it } from 'vitest'
import { emitRecord } from '../src/city-life-telling/ava_record/emit.ts'
import { FIXTURE_NOW, FIXTURE_PROFILES, syntheticEmitInput } from '../src/city-life-telling/ava_record/corpus.ts'
import { dialogBlock, evidenceFromRecord, squareState } from '../src/city-life-telling/ava_record/square.ts'
import type { StoryRecord } from '../src/city-life-telling/ava_record/types.ts'

function okRecord(index = 0): StoryRecord {
  const result = emitRecord(syntheticEmitInput(index, FIXTURE_PROFILES.request_311, FIXTURE_NOW))
  if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
  return result.record
}

describe('the citizen-model square (brief §6)', () => {
  const model = { run_id: 'clt-corpus#run1', baseline_id: 'baseline-1', expected: 10, observed: 11, tolerance: 2 }

  it('both yes within tolerance → confirmed', () => {
    const r = squareState({ instrumented: true, reported: true, model })
    expect(r.state).toBe('confirmed')
    expect(r.model_check?.residual).toBe(1) // recomputed, not trusted
  })

  it('both yes, residual outside tolerance → blind_spot (model misses the magnitude)', () => {
    const r = squareState({ instrumented: true, reported: true, model: { ...model, observed: 20 } })
    expect(r.state).toBe('blind_spot')
    expect(r.model_check?.residual).toBe(10)
  })

  it('evidence yes, model no → blind_spot (the model misses a reported problem)', () => {
    expect(squareState({ instrumented: true, reported: true, model: { ...model, expected: 0 } }).state).toBe('blind_spot')
  })

  it('model yes, nothing reported → silent_problem (agents drop activities nobody reports)', () => {
    const r = squareState({ instrumented: false, reported: false, model })
    expect(r.state).toBe('silent_problem')
  })

  it('both no → normal', () => {
    expect(squareState({ instrumented: false, reported: false, model: null }).state).toBe('normal')
  })

  it('evidence without a model run is pending, never guessed', () => {
    expect(squareState({ instrumented: true, reported: true, model: null }).state).toBe('pending')
    expect(squareState({ instrumented: false, reported: true, model: null }).state).toBe('pending')
  })

  it('the stub evidence reader derives instrumented/reported from the record', () => {
    const record = okRecord(0)
    const ev = evidenceFromRecord(record)
    expect(ev.reported).toBe(record.channels.critical_functional.present)
    // stub rule: trust A/B, or at least one independent corroboration
    expect(ev.instrumented).toBe(
      record.routing.trust_level === 'A' || record.routing.trust_level === 'B' || record.links.corroborating >= 1,
    )
    expect(ev.model).toBeNull()
    // operator feed fixture → trust B → instrumented
    const feed = emitRecord(syntheticEmitInput(4, FIXTURE_PROFILES.operator_feed, FIXTURE_NOW))
    if (!feed.ok) throw new Error('emit failed')
    expect(evidenceFromRecord(feed.record).instrumented).toBe(true)
  })

  it('dialogBlock recomputes the quadrant instead of trusting a label', () => {
    const block = dialogBlock({ instrumented: true, reported: true, model })
    expect(block.state).toBe('confirmed')
    expect(block.model_check).toEqual({ ...model, residual: 1 })
  })
})
