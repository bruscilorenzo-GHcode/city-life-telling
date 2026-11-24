import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJson, contentHash, deterministicUuid, sha256Hex } from '../src/city-life-telling/ava_record/hash.ts'
import { validateAgainstSchema } from '../src/city-life-telling/ava_record/validate.ts'
import { validateStoryRecord, type StoryRecord } from '../src/city-life-telling/ava_record/types.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemaCopy = resolve(root, 'schemas/ava-story-record-1.0.json')
const schemaSource = resolve(root, 'docs/integration/ava-story-record-1.0.schema.json')

function schemaFile(): unknown {
  return JSON.parse(readFileSync(schemaCopy, 'utf8'))
}

/** A minimal valid record, written by hand (no emit dependency): the same
 *  shape the schema and the typed validator must both accept. */
export const MINIMAL_RECORD: StoryRecord = {
  schema_version: '1.0',
  record_id: 'e56877d1-fe5d-5696-8459-d8156928e0ee',
  revision: 1,
  created_at: '2026-11-18T15:31:33Z',
  supersedes: null,
  content_hash: 'sha256:' + 'a'.repeat(64),
  source: {
    kind: 'panel',
    ref: 'city-life-telling.stories.v1#st_test000',
    collected_at: '2026-11-16T13:20:00Z',
    medium: 'form',
    language: 'fr',
  },
  consent: {
    geolocation: true,
    granularity: 'city',
    calibration_use: 'granted',
    regime: 'socio_narrative',
    licence: 'CC0-1.0',
  },
  time: {
    observed_at: '2026-11-16T13:20:00Z',
    precision: 'minute',
    day_type: 'weekday',
    service_period: 'am_peak',
  },
  space: {
    h3: null,
    zone_id: 'gr_r8_45.5100_-73.5600',
    network_element: { type: 'link', id: 'bus-80', network_source: 'matsim-seed-montreal' },
    od_pair: null,
  },
  channels: {
    critical_functional: {
      present: true,
      problem_class: 'waiting_excessive',
      severity: 4,
      abstract: 'The bus arrived 25 minutes late and nobody had information.',
    },
    dramaturgical: {
      narrative_layer: 'microcrisis',
      valence: -0.4,
      arousal: 0.2,
      temporal_tension: 0.6,
    },
  },
  routing: {
    parameter_class: 'theta_cap',
    parameter_key: 'capacity.stop.bus-80',
    direction: 'decrease',
    target: 'stop',
    segment: null,
    confidence: 0.63,
    trust_level: 'D',
    calibration_eligible: true,
    override: false,
    reason_short: 'rule 2: waiting_excessive → theta_cap decrease stop',
    rule_id: 2,
  },
  observation: {
    value: { type: 'ordinal', ordinal: 'severe' },
    unit: 'severity_1_5',
    uncertainty: 0.37,
    weight: 0.1814,
    decay: { half_life_hours: 72, t_ref: '2026-11-16T13:20:00Z', computed_at: '2026-11-18T15:31:33Z' },
    clock: 'minute',
  },
  dialog: { state: 'pending', model_check: null },
  links: {
    corroborating: 0,
    story_ids: ['st_test000'],
    run_id: null,
    scenario_id: null,
    response_ref: null,
  },
  provenance: {
    annotator: {
      engine: 'jev',
      version: 'clt-emit-1.0.0',
      model_id: null,
      prompt_hash: null,
      primitive: 'score',
      confidence: 0.63,
    },
    human_review: false,
    reviewer: null,
    reviewed_at: null,
    review_notes: 'test record',
  },
}

describe('the schema copy', () => {
  it('is byte-identical to the normative document in docs/integration', () => {
    const a = readFileSync(schemaCopy)
    const b = readFileSync(schemaSource)
    expect(a.equals(b)).toBe(true)
  })
})

describe('hash utilities', () => {
  it('sha256 matches the FIPS vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('canonical JSON is independent of key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
    expect(canonicalJson([{ c: 1 }, null])).toBe('[{"c":1},null]')
  })

  it('deterministicUuid is stable and uuid-shaped', () => {
    const u1 = deterministicUuid('seed-x')
    const u2 = deterministicUuid('seed-x')
    expect(u1).toBe(u2)
    expect(deterministicUuid('seed-y')).not.toBe(u1)
    expect(u1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('content_hash excludes the content_hash field itself', () => {
    const r = { ...MINIMAL_RECORD }
    const h1 = contentHash(r)
    const withHash = { ...r, content_hash: 'sha256:' + 'b'.repeat(64) }
    expect(contentHash(withHash)).toBe(h1)
  })
})

describe('the two validators agree', () => {
  it('the hand-written minimal record is valid for both', () => {
    expect(validateAgainstSchema(MINIMAL_RECORD, schemaFile()).ok).toBe(true)
    expect(validateStoryRecord(MINIMAL_RECORD).ok).toBe(true)
  })

  it('mutations are rejected identically by both', () => {
    const mutations: Array<[string, unknown]> = [
      ['revision', 0], // below minimum
      ['schema_version', '0.9'], // wrong const
    ]
    for (const [key, value] of mutations) {
      const broken = { ...MINIMAL_RECORD, [key]: value }
      expect(validateAgainstSchema(broken, schemaFile()).ok).toBe(false)
      expect(validateStoryRecord(broken).ok).toBe(false)
    }
    const badSeverity = structuredClone(MINIMAL_RECORD)
    badSeverity.channels.critical_functional.severity = 9
    expect(validateAgainstSchema(badSeverity, schemaFile()).ok).toBe(false)
    expect(validateStoryRecord(badSeverity).ok).toBe(false)
    const extraField = { ...MINIMAL_RECORD, raw_text: 'stray' }
    expect(validateAgainstSchema(extraField, schemaFile()).ok).toBe(false)
    expect(validateStoryRecord(extraField).ok).toBe(false)
    const nestedExtra = structuredClone(MINIMAL_RECORD)
    ;(nestedExtra.space as unknown as Record<string, unknown>).coordinates = '45.51,-73.56'
    expect(validateAgainstSchema(nestedExtra, schemaFile()).ok).toBe(false)
    expect(validateStoryRecord(nestedExtra).ok).toBe(false)
  })
})
