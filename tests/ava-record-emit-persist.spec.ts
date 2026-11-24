import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../src/city-life-telling/ava_record/hash.ts'
import { claimToProblemClass, emitRecord, severityFrom, abstractFrom, mentionsShift, dayTypeFrom, servicePeriodFrom } from '../src/city-life-telling/ava_record/emit.ts'
import { FIXTURE_NOW, FIXTURE_PROFILES, syntheticCorpusInput, syntheticEmitInput } from '../src/city-life-telling/ava_record/corpus.ts'
import { checkInvariants } from '../src/city-life-telling/ava_record/invariants.ts'
import { addRecord, loadRecords, supersedeRecord, maybeEmitForStory, MAX_RECORDS, RECORDS_KEY, type MinimalStorage } from '../src/city-life-telling/ava_record/persist.ts'
import { validateAgainstSchema } from '../src/city-life-telling/ava_record/validate.ts'
import { validateStoryRecord, type StoryRecord } from '../src/city-life-telling/ava_record/types.ts'
import { publishCityStory } from '../src/city-life-telling/store'
import { simulateSnapshot } from '../src/city-life-telling/matsim/simulated-source.ts'
import type { AvaReading } from '../src/city-life-telling/ava-agent.ts'
import type { StorySignal } from '../src/city-life-telling/signal.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemaCopy = resolve(root, 'schemas/ava-story-record-1.0.json')
const fixturesDir = resolve(root, 'src/city-life-telling/fixtures')
const KINDS = ['request_311', 'assisted_story', 'interview', 'panel', 'operator_feed'] as const
/** One synthetic story index per source kind (mirrors scripts/generate-ava-fixtures.ts). */
const SEEDS: Record<(typeof KINDS)[number], number> = {
  request_311: 0,
  assisted_story: 1,
  interview: 2,
  panel: 3,
  operator_feed: 4,
}

function schemaFile(): unknown {
  return JSON.parse(readFileSync(schemaCopy, 'utf8'))
}

function storage(): MinimalStorage & { dump(): string | null } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
    dump: () => map.get(RECORDS_KEY) ?? null,
  }
}

function okRecord(index = 0, now = FIXTURE_NOW): StoryRecord {
  const result = emitRecord(syntheticCorpusInput(index, now))
  if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
  return result.record
}

describe('I1 — every fixture validates against the JSON Schema', () => {
  for (const kind of KINDS) {
    it(`${kind}`, () => {
      const line = readFileSync(resolve(fixturesDir, `ava-record-${kind}.jsonl`), 'utf8').trim()
      const record = JSON.parse(line) as unknown
      const generic = validateAgainstSchema(record, schemaFile())
      expect(generic.errors).toEqual([])
      const typed = validateStoryRecord(record)
      expect(typed.errors).toEqual([])
      expect(generic.ok).toBe(typed.ok) // the two validators agree
    })
  }
})

describe('I2/I9 — determinism and idempotency of the emit path', () => {
  it('re-emitting the committed annotation regenerates the fixture byte-identically', () => {
    for (const kind of KINDS) {
      const annotation = JSON.parse(
        readFileSync(resolve(fixturesDir, `annotations/${kind}.json`), 'utf8'),
      ) as Parameters<typeof emitRecord>[0]
      const result = emitRecord(annotation)
      if (!result.ok) throw new Error(`emit failed for ${kind}: ${result.errors.join('; ')}`)
      const stored = readFileSync(resolve(fixturesDir, `ava-record-${kind}.jsonl`), 'utf8')
      expect(result.jsonl + '\n').toBe(stored)
      // same input, same hash, same record_id (I9)
      const again = emitRecord(annotation)
      if (!again.ok) throw new Error('second emit failed')
      expect(again.record.content_hash).toBe(result.record.content_hash)
      expect(again.record.record_id).toBe(result.record.record_id)
    }
  })
})

describe('I10 — no raw text / no fields outside the schema', () => {
  it('a stray raw_text field is rejected by both validators', () => {
    const record = JSON.parse(
      readFileSync(resolve(fixturesDir, 'ava-record-request_311.jsonl'), 'utf8'),
    ) as StoryRecord
    const poisoned = { ...record, raw_text: 'the citizen full story would be here' }
    const generic = validateAgainstSchema(poisoned, schemaFile())
    expect(generic.ok).toBe(false)
    expect(generic.errors.some((e) => e.path.includes('raw_text'))).toBe(true)
    expect(validateStoryRecord(poisoned).ok).toBe(false)
  })

  it('emitted records never contain the narrative channel text', () => {
    for (const kind of KINDS) {
      const input = syntheticEmitInput(SEEDS[kind], FIXTURE_PROFILES[kind], FIXTURE_NOW)
      const result = emitRecord(input)
      if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
      expect(canonicalJson(result.record)).not.toContain(input.channels.narrative)
      // the abstract is the de-identified, in-schema one-sentence field
      expect(result.record.channels.critical_functional.abstract.length).toBeLessThanOrEqual(400)
    }
  })
})

describe('the deterministic emit mapping', () => {
  it('claim kinds map to problem classes with fixed rules', () => {
    const reading = { correlations: [] } as unknown as AvaReading
    expect(claimToProblemClass(undefined, reading)).toBe('none')
    expect(claimToProblemClass({ lineId: 'bus-80', kind: 'delay' }, reading)).toBe('waiting_excessive')
    expect(claimToProblemClass({ lineId: 'bus-80', kind: 'cancelled' }, reading)).toBe('boarding_denied')
    expect(claimToProblemClass({ lineId: 'bus-80', kind: 'closed' }, reading)).toBe('works')
    expect(claimToProblemClass({ lineId: 'bus-80', kind: 'mechanical' }, reading)).toBe('incident')
    expect(claimToProblemClass({ lineId: 'bus-80', kind: 'other' }, reading)).toBe('other')
    // crowding → perceived_crowding, or vehicle_full when the sim confirms at load ≥ 0.9
    expect(claimToProblemClass({ lineId: 'bus-80', kind: 'crowding' }, reading)).toBe('perceived_crowding')
    const confirming = {
      correlations: [{ claim: { lineId: 'bus-80', kind: 'crowding' }, verdict: 'confirms', simLoad: 0.95 }],
    } as unknown as AvaReading
    expect(claimToProblemClass({ lineId: 'bus-80', kind: 'crowding' }, confirming)).toBe('vehicle_full')
  })

  it('severity follows fixed rules from the signal and the reading', () => {
    const signal = { band: 'balanced' } as StorySignal
    const reading = { verdict: 'partially', verdictScore: 50 } as AvaReading
    expect(severityFrom(signal, reading)).toBe(3)
    expect(severityFrom(signal, { verdict: 'confirms', verdictScore: 80 } as AvaReading)).toBe(4)
    expect(severityFrom(signal, { verdict: 'diverges', verdictScore: 0 } as AvaReading)).toBe(2)
    expect(severityFrom({ band: 'saturated-facts' } as StorySignal, reading)).toBe(4)
    expect(severityFrom({ band: 'saturated-fiction' } as StorySignal, reading)).toBe(2)
    expect(severityFrom({ band: 'saturated-facts' } as StorySignal, { verdict: 'confirms', verdictScore: 90 } as AvaReading)).toBe(5)
    expect(severityFrom({ band: 'saturated-fiction' } as StorySignal, { verdict: 'diverges', verdictScore: 0 } as AvaReading)).toBe(1)
  })

  it('the abstract is the scrubbed first sentence, de-identified (emails/plates/phones)', () => {
    const a = abstractFrom({ functional: 'Plate AB 123CD, write mario@example.com or call 514 555 0100, I waited 40 minutes on rue Saint-Denis yesterday 8h.', narrative: '' })
    expect(a).not.toContain('mario@example.com')
    expect(a).not.toContain('AB 123CD')
    expect(a).not.toContain('514 555 0100')
    expect(a).not.toContain('rue Saint-Denis')
    expect(a).toContain('waited')
  })

  it('the shift lexicon is trilingual and deterministic', () => {
    expect(mentionsShift({ functional: 'turno di notte', narrative: '' })).toBe(true)
    expect(mentionsShift({ functional: 'mon horaire fixe change', narrative: '' })).toBe(true)
    expect(mentionsShift({ functional: 'my shift starts at 5', narrative: '' })).toBe(true)
    expect(mentionsShift({ functional: 'la linea era in ritardo', narrative: '' })).toBe(false)
  })

  it('day type and service period derive from Montréal local time (EST fixed)', () => {
    expect(dayTypeFrom('2026-11-16T13:20:00Z')).toBe('weekday') // Monday
    expect(dayTypeFrom('2026-11-15T13:20:00Z')).toBe('weekend') // Sunday
    expect(servicePeriodFrom('2026-11-16T13:20:00Z')).toBe('am_peak') // 08:20 local
    expect(servicePeriodFrom('2026-11-16T08:20:00Z')).toBe('night') // 03:20 local
    expect(servicePeriodFrom('2026-11-16T02:20:00Z')).toBe('evening') // 21:20 local
    expect(servicePeriodFrom('2026-11-16T23:20:00Z')).toBe('pm_peak') // 18:20 local
    expect(servicePeriodFrom('2026-11-17T00:20:00Z')).toBe('evening') // 19:20 local
  })

  it('geography follows docs/RECON.md §9: h3 null, city granularity, cell in zone_id, note in provenance', () => {
    const record = okRecord(0)
    expect(record.space.h3).toBeNull()
    expect(record.consent.granularity).toBe('city')
    expect(record.space.zone_id).toBe('gr_r8_45.5100_-73.5600')
    expect(record.provenance.review_notes).toContain('H3')
    expect(record.provenance.annotator).toEqual({
      engine: 'jev', version: expect.any(String), model_id: null, prompt_hash: null,
      primitive: 'score', confidence: expect.any(Number),
    })
    expect(record.provenance.annotator.confidence).toBeCloseTo(record.routing.confidence, 6)
  })

  it('emission fails closed on missing inputs', () => {
    const input = syntheticCorpusInput(0)
    const broken = { ...input, signal: undefined } as unknown as Parameters<typeof emitRecord>[0]
    const result = emitRecord(broken)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.code).toBe('input')
  })
})

describe('I3/I4/I5 — invariants on emitted and malformed records', () => {
  it('a dramaturgical-only story without markers routes to theta_perc and is never eligible (I3)', () => {
    // index 9: no line claim, no shift mention → row 12
    const input = syntheticCorpusInput(9)
    const result = emitRecord(input)
    if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
    const record = result.record
    expect(record.channels.critical_functional.present).toBe(false)
    expect(record.routing.rule_id).toBe(12)
    expect(record.routing.parameter_class).toBe('theta_perc')
    expect(record.routing.calibration_eligible).toBe(false)
  })

  it('a dram-only story that mentions a shift lands on row 8 but stays ineligible (I3)', () => {
    // index 8: 'linea 54' is not a known line, but 'turno' appears
    const input = syntheticCorpusInput(8)
    const result = emitRecord(input)
    if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
    const record = result.record
    expect(record.channels.critical_functional.present).toBe(false)
    expect(record.routing.rule_id).toBe(8)
    expect(record.routing.calibration_eligible).toBe(false)
  })

  it('consent denied forces eligibility false while the record stays complete (I4)', () => {
    const input = syntheticCorpusInput(3) // index 3 → calibration denied
    const result = emitRecord(input)
    if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
    const record = result.record
    expect(record.consent.calibration_use).toBe('denied')
    expect(record.routing.calibration_eligible).toBe(false)
    expect(validateAgainstSchema(record, schemaFile()).ok).toBe(true)
  })

  it('city granularity without a zone_id cannot route sub-city (I5)', () => {
    const record = okRecord(0)
    const broken = {
      ...record,
      space: { ...record.space, zone_id: null },
      routing: { ...record.routing, target: 'stop' },
    } as StoryRecord
    const report = checkInvariants(broken)
    expect(report.invariant.some((i) => i.startsWith('I5'))).toBe(true)
  })
})

describe('persistence — append-only, capped, superseding', () => {
  it('adds valid records and rejects invalid ones (fail-closed)', () => {
    const store = storage()
    const record = okRecord(0)
    const added = addRecord(record, store)
    expect(added.added).toBe(true)
    expect(loadRecords(store)).toHaveLength(1)
    const poisoned = { ...record, record_id: 'not-a-uuid' } as StoryRecord
    const rejected = addRecord(poisoned, store)
    expect(rejected.added).toBe(false)
    expect(rejected.reason).toBe('invalid_record')
    expect(loadRecords(store)).toHaveLength(1)
  })

  it('the same content is a no-op (I9 idempotency)', () => {
    const store = storage()
    const record = okRecord(0)
    expect(addRecord(record, store).added).toBe(true)
    const again = addRecord(structuredClone(record), store)
    expect(again.added).toBe(false)
    expect(again.reason).toBe('duplicate')
    expect(loadRecords(store)).toHaveLength(1)
  })

  it('a revision is a new record with supersedes and revision+1; the old row stays untouched', () => {
    const store = storage()
    const before = okRecord(0)
    addRecord(before, store)
    const input = syntheticCorpusInput(0)
    const result = supersedeRecord(before, { ...input, review_notes: 'severity corrected by reviewer' }, FIXTURE_NOW, store)
    expect(result.ok).toBe(true)
    const records = loadRecords(store)
    expect(records).toHaveLength(2)
    expect(records[0]!.revision).toBe(1)
    expect(records[1]!.revision).toBe(2)
    expect(records[1]!.supersedes).toBe(before.record_id)
    expect(records[0]).toEqual(before) // append-only
  })

  it('the FIFO cap keeps the newest MAX_RECORDS', () => {
    const store = storage()
    for (let i = 0; i < MAX_RECORDS + 10; i++) {
      // distinct `now` per entry → distinct content_hash (no dedup skips)
      const now = new Date(Date.parse(FIXTURE_NOW) + i * 1000).toISOString()
      const result = emitRecord(syntheticCorpusInput(i % 60, now))
      if (!result.ok) throw new Error(`emit failed: ${result.errors.join('; ')}`)
      addRecord(result.record, store)
    }
    expect(loadRecords(store)).toHaveLength(MAX_RECORDS)
  })

  it('the flag gate keeps emission off by default and the publish flow untouched', async () => {
    const snapshot = simulateSnapshot(20261105, 7, new Date('2026-11-05T13:20:00Z'), 'clt-synthetic-montreal-v1')
    const consent = { geo_mode: 'grid' as const, allow_dispatch: true }
    const story = await publishCityStory(
      {
        narrative: 'Je me souviens de ma grand-mère dans la verte, comme une chanson douce de la ville.',
        functional: 'Hier 8h15, ligne verte: 12 minutes d\'attente, quai bondé.',
        lang: 'fr', lat: 45.5183, lon: -73.5686,
      },
      consent,
      snapshot,
    )
    // flag off → nothing stored
    const store = storage()
    const g = globalThis as { localStorage?: MinimalStorage }
    const previous = g.localStorage
    g.localStorage = store
    try {
      maybeEmitForStory(story)
      expect(store.dump()).toBeNull()
      // flag on → exactly one record is emitted and persisted, additively
      store.setItem('city-life-telling.ava-record-emit.v1', 'on')
      const result = maybeEmitForStory(story)
      expect(result?.ok).toBe(true)
      expect(store.dump()).not.toBeNull()
      expect(loadRecords(store)).toHaveLength(1)
      // the emitted record is denied consent (calibration not collected yet)
      expect(loadRecords(store)[0]!.consent.calibration_use).toBe('denied')
      expect(loadRecords(store)[0]!.routing.calibration_eligible).toBe(false)
    } finally {
      if (previous === undefined) delete (globalThis as Record<string, unknown>).localStorage
      else g.localStorage = previous
    }
  })
})

describe('the 200-record corpus, end to end (brief §9 day 5)', () => {
  const N = 200
  const records: StoryRecord[] = []
  const failures: string[] = []

  for (let i = 0; i < N; i++) {
    const result = emitRecord(syntheticCorpusInput(i))
    if (!result.ok) { failures.push(`${i}: ${result.code}: ${result.errors.join('; ')}`); continue }
    const record = result.record
    const schema = validateAgainstSchema(record, schemaFile())
    if (!schema.ok) { failures.push(`${i}: schema: ${schema.errors.map((e) => e.path).join(',')}`); continue }
    const typed = validateStoryRecord(record)
    if (!typed.ok) { failures.push(`${i}: typed: ${typed.errors.map((e) => e.path).join(',')}`); continue }
    const invariants = checkInvariants(record)
    if (invariants.consent.length > 0 || invariants.invariant.length > 0) {
      failures.push(`${i}: invariants: ${[...invariants.consent, ...invariants.invariant].join('; ')}`)
      continue
    }
    records.push(record)
  }

  it('all 200 records emit, validate and stay invariant-clean', () => {
    expect(failures).toEqual([])
    expect(records).toHaveLength(N)
  })

  it('record ids are unique per distinct content (I9)', () => {
    const ids = new Set(records.map((r) => r.record_id))
    expect(ids.size).toBe(N)
  })

  it('consent discipline holds across the corpus (I4)', () => {
    for (const record of records) {
      if (record.consent.calibration_use === 'denied') {
        expect(record.routing.calibration_eligible).toBe(false)
      }
      if (record.consent.granularity === 'city') {
        expect(record.space.h3).toBeNull()
      }
    }
  })

  it('the corpus exercises the parameter classes the app analysis can reach', () => {
    const classes = new Set(records.map((r) => r.routing.parameter_class))
    // theta_OD (row 7 needs an od_pair) and theta_beh (row 10 needs claim
    // kinds the app cannot state yet) are unreachable by design — open
    // mapping documented in the report (§12).
    expect(classes.has('theta_cap')).toBe(true)
    expect(classes.has('theta_evt')).toBe(true)
    expect(classes.has('theta_perc')).toBe(true)
    expect(classes.has('theta_pers')).toBe(true)
  })

  it('no raw narrative text leaks into any record (I10)', () => {
    for (let i = 0; i < N; i++) {
      const input = syntheticCorpusInput(i)
      const record = records[i]!
      expect(JSON.stringify(record)).not.toContain(input.channels.narrative)
    }
  })
})
