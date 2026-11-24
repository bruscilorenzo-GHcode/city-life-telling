/** AVA Story Record — deterministic emit path (brief §8, day 5).
 *
 *  Builds the typed record from the analysis the app already computes —
 *  `analyzeStory` (signal.ts) + `detectClaims`/`avaRead` (ava-agent.ts) —
 *  without ever putting raw citizen text in the record. Every mapping is a
 *  fixed rule written here and tested in tests/ava-record-*.spec.ts:
 *
 *  claim kind → problem_class
 *      delay      → waiting_excessive
 *      cancelled  → boarding_denied
 *      closed     → works            (line/stop closure)
 *      mechanical → incident
 *      crowding   → vehicle_full     when the sim corroborates at load ≥ 0.9
 *                 → perceived_crowding otherwise
 *      other      → other
 *      no claims  → none             (dramaturgical-only, row 12)
 *
 *  severity (1–5): base 3; +1 if the reading confirms with score ≥ 80;
 *  −1 if it diverges; +1 if band = saturated-facts; −1 if
 *  saturated-fiction; clamped to [1,5].
 *
 *  valence = (fiction − facts)/100, arousal = emotionalMarkers·2 − 1,
 *  temporal_tension = (figurative + emotional)/2 — fixed derivations from
 *  the signal; the dramaturgical channel carries no calibration weight by
 *  design.
 *
 *  Geography (docs/RECON.md §9): the app's deg-grid cell `gr_r8_*` (~110 m)
 *  is NOT convertible to H3 without the h3 library — no new runtime
 *  dependency — so emit declares the conversion open: `space.h3 = null`,
 *  `consent.granularity = 'city'`, the cell preserved in `space.zone_id`,
 *  and the declaration written into `provenance.review_notes`.
 *
 *  `provenance.annotator = { engine: 'jev', primitive: 'score',
 *  confidence: signal.facts/100 }`: deterministic, no LLM in the path.
 *
 *  Pure: same input ⇒ byte-identical JSONL (I2); `now` is an explicit
 *  parameter, never a hidden clock. */

import { scrubText } from '../../assist-urban/pipeline/pii.ts'
import type { AvaReading, StoryClaim } from '../ava-agent.js'
import type { StorySignal } from '../signal.js'
import { canonicalJson, contentHash, deterministicUuid } from './hash.ts'
import { checkInvariants } from './invariants.ts'
import { routeAnnotation, type RoutingAnnotation } from './route.ts'
import { dialogBlock } from './square.ts'
import {
  CLASS_CLOCK, HALF_LIFE_HOURS, computeWeight,
} from './weight.ts'
import {
  validateStoryRecord,
  type DayType, type ModelCheck, type ProblemClass, type ServicePeriod,
  type SourceKind, type SourceMedium, type StoryRecord, type TimePrecision, type TrustLevel,
} from './types.ts'

export const EMIT_VERSION = 'clt-emit-1.0.0'

/** H3 / deg-grid conversion declaration carried in every emitted record. */
export const H3_CONVERSION_NOTE =
  'deg-grid r8 cell (~110 m) preserved in space.zone_id; space.h3=null with consent.granularity=city:'
  + ' H3 (r8 ~0.7 km) conversion deferred to the upstream annotator per docs/RECON.md §9'
  + ' (cell sizes are not comparable: deg r8 ~110 m vs H3 r8 ~700 m).'

export interface EmitConsent {
  geolocation: boolean
  granularity: 'h3_r7' | 'h3_r8' | 'h3_r9' | 'city'
  calibration_use: 'granted' | 'denied'
  regime: 'socio_narrative' | 'journalistic' | 'touristic'
  licence: string
}

export interface EmitInput {
  source_kind: SourceKind
  /** Opaque pointer into the story store — never the text itself. */
  source_ref: string
  story_id: string
  collected_at: string
  medium: SourceMedium
  language: string
  /** Anonymous deg-grid cell `gr_r8_…` or null. */
  cell: string | null
  trust_level: TrustLevel
  /** Emit instant (ISO date-time) — explicit for determinism. */
  now: string
  /** Raw channels: consumed for analysis only, never stored in the record. */
  channels: { functional: string, narrative: string }
  signal: StorySignal
  claims: StoryClaim[]
  reading: AvaReading
  consent: EmitConsent
  observed_at?: string
  precision?: TimePrecision
  day_type?: DayType
  service_period?: ServicePeriod
  model_check?: ModelCheck | null
  revision?: number
  supersedes?: string | null
  human_review?: boolean
  /** Extra review notes, appended after the H3 conversion declaration. */
  review_notes?: string | null
  /** Snapshot the reading was judged against (for links.run_id). */
  snapshot?: { contract: string, scenario: string, tick: number, generatedAt: string } | null
}

export type EmitErrorCode = 'schema' | 'invariant' | 'consent' | 'input'

export type EmitResult =
  | { ok: true, record: StoryRecord, jsonl: string }
  | { ok: false, code: EmitErrorCode, errors: string[] }

const SEVERITY_ORDINAL: Record<number, 'none' | 'mild' | 'significant' | 'severe'> = {
  1: 'none', 2: 'mild', 3: 'significant', 4: 'severe', 5: 'severe',
}

/** claim kind → problem_class (fixed mapping, see module header). */
export function claimToProblemClass(claim: StoryClaim | undefined, reading: AvaReading): ProblemClass {
  if (!claim) return 'none'
  switch (claim.kind) {
    case 'delay': return 'waiting_excessive'
    case 'cancelled': return 'boarding_denied'
    case 'closed': return 'works'
    case 'mechanical': return 'incident'
    case 'crowding': {
      const corr = reading.correlations.find((c) => c.claim.lineId === claim.lineId)
      return corr !== undefined && corr.verdict === 'confirms' && corr.simLoad >= 0.9 ? 'vehicle_full' : 'perceived_crowding'
    }
    default: return 'other'
  }
}

/** Severity 1–5 from the signal/reading with fixed rules (module header). */
export function severityFrom(signal: StorySignal, reading: AvaReading): number {
  let severity = 3
  if (reading.verdict === 'confirms' && reading.verdictScore >= 80) severity += 1
  if (reading.verdict === 'diverges') severity -= 1
  if (signal.band === 'saturated-facts') severity += 1
  if (signal.band === 'saturated-fiction') severity -= 1
  return Math.min(5, Math.max(1, severity))
}

/** De-identified one-sentence abstract (scrubbed, ≤ 400 chars): the first
 *  sentence of the functional channel, else of the narrative one. */
export function abstractFrom(channels: { functional: string, narrative: string }): string | null {
  for (const text of [channels.functional, channels.narrative]) {
    const first = (text ?? '').split(/(?<=[.!?…])\s+/).map((s) => s.trim()).find((s) => s.length > 0)
    if (first) {
      const scrubbed = scrubText(first).text.replace(/\s+/g, ' ').trim()
      if (scrubedMeaningful(scrubbed)) return scrubbed.slice(0, 400)
    }
  }
  return null
}

const scrubedMeaningful = (s: string) => s.replace(/█/g, '').trim().length > 0

/** Trilingual shift/fixed-appointment lexicon — resolved here into the
 *  typed boolean consumed by routing row 8. */
const SHIFT_RE = /\b(turn[oi]|turni|orario fisso|turno di (notte|giorno)|shift|shifts|night shift|horaires?|horaire fixe|quart( de travail)?|shift work|turnus|schedule[ds]? to|turno fisso)\b/i

export function mentionsShift(channels: { functional: string, narrative: string }): boolean {
  return SHIFT_RE.test(`${channels.functional}\n${channels.narrative}`)
}

/** Montréal local wall time = UTC − 5 (fixed EST; DST left open, §12). */
const EST_OFFSET_MS = 5 * 3_600_000

export function dayTypeFrom(iso: string): DayType {
  const local = new Date(Date.parse(iso) - EST_OFFSET_MS)
  const day = local.getUTCDay()
  return day === 0 || day === 6 ? 'weekend' : 'weekday'
}

export function servicePeriodFrom(iso: string): ServicePeriod {
  const localHour = new Date(Date.parse(iso) - EST_OFFSET_MS).getUTCHours()
  if (localHour < 6) return 'night'
  if (localHour < 9) return 'am_peak'
  if (localHour < 16) return 'midday'
  if (localHour < 19) return 'pm_peak'
  return 'evening'
}

function fail(code: EmitErrorCode, errors: string[]): EmitResult {
  return { ok: false, code, errors }
}

/** Derive the typed routing annotation from a full emit input (CLI reuse):
 *  the same fixed rules the emit path applies, nothing else. */
export function routingAnnotationFrom(input: EmitInput): RoutingAnnotation {
  const firstClaim = input.claims.length > 0 ? input.claims[0]! : undefined
  const problemClass = claimToProblemClass(firstClaim, input.reading)
  const observedAt = input.observed_at ?? input.collected_at
  return {
    problem_class: problemClass,
    critical_functional_present: problemClass !== 'none',
    day_type: input.day_type ?? dayTypeFrom(observedAt),
    od_pair_present: false, // the app has no OD data: row 7 stays unreachable, documented
    dramaturgical_mention_shift: mentionsShift(input.channels),
    subject: firstClaim ? firstClaim.lineId : input.cell ?? null,
  }
}

/** Emit one record. Fail-closed: missing input → rejection, no inference. */
export function emitRecord(input: EmitInput): EmitResult {
  // --- fail-closed input checks (schema-level rejections) -----------------
  const missing: string[] = []
  if (!input.source_kind) missing.push('source_kind')
  if (typeof input.source_ref !== 'string' || input.source_ref.length === 0) missing.push('source_ref')
  if (typeof input.story_id !== 'string' || input.story_id.length === 0) missing.push('story_id')
  if (!input.collected_at || Number.isNaN(Date.parse(input.collected_at))) missing.push('collected_at')
  if (!input.medium) missing.push('medium')
  if (typeof input.language !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(input.language)) missing.push('language')
  if (!input.trust_level) missing.push('trust_level')
  if (!input.now || Number.isNaN(Date.parse(input.now))) missing.push('now')
  if (!input.signal || typeof input.signal.realityIndex !== 'number') missing.push('signal')
  if (!Array.isArray(input.claims)) missing.push('claims')
  if (!input.reading || typeof input.reading.verdictScore !== 'number') missing.push('reading')
  if (!input.consent) missing.push('consent')
  if (missing.length > 0) return fail('input', [`missing or malformed input fields: ${missing.join(', ')}`])

  const abstract = abstractFrom(input.channels)
  if (abstract === null) {
    return fail('schema', ['both channels are empty: no de-identified abstract can exist (fail-closed)'])
  }

  const now = input.now
  const observedAt = input.observed_at ?? input.collected_at
  const revision = input.revision ?? 1
  const supersedes = input.supersedes ?? null

  // --- deterministic annotation from the existing analysis ----------------
  const firstClaim = input.claims.length > 0 ? input.claims[0]! : undefined
  const problemClass = claimToProblemClass(firstClaim, input.reading)
  const cfPresent = problemClass !== 'none'
  const severity = severityFrom(input.signal, input.reading)
  const confidence = Math.round(input.signal.facts) / 100
  const dayType = input.day_type ?? dayTypeFrom(observedAt)
  const servicePeriod = input.service_period ?? servicePeriodFrom(observedAt)
  const shift = mentionsShift(input.channels)
  const subject = firstClaim ? firstClaim.lineId : input.cell ?? null

  const decision = routeAnnotation({
    problem_class: problemClass,
    critical_functional_present: cfPresent,
    day_type: dayType,
    od_pair_present: false, // the app has no OD data: row 7 stays unreachable, documented
    dramaturgical_mention_shift: shift,
    subject,
  })

  const trust: TrustLevel = input.trust_level
  const eligible =
    input.consent.calibration_use === 'granted'
    && (input.consent.granularity !== 'city' || input.cell !== null)
    && trust !== 'E'
    && cfPresent

  const override = trust !== 'D' && trust !== 'E'

  // --- geography: deg-grid cell kept in zone_id, h3 declared open --------
  const h3: string | null = null // city granularity: H3 conversion deferred (RECON §9)
  const networkElement = firstClaim
    ? { type: 'link' as const, id: firstClaim.lineId, network_source: 'matsim-seed-montreal' }
    : null

  // --- weight at emit instant --------------------------------------------
  const halfLife = HALF_LIFE_HOURS[decision.parameter_class]
  const breakdown = computeWeight(confidence, trust, observedAt, halfLife, now)
  const weight = breakdown.weight

  const record: StoryRecord = {
    schema_version: '1.0',
    record_id: deterministicUuid(canonicalJson({
      v: 'ava-story-record-1.0', source_ref: input.source_ref, collected_at: input.collected_at,
      revision, supersedes,
    })),
    revision,
    created_at: now,
    supersedes,
    content_hash: '',
    source: {
      kind: input.source_kind,
      ref: input.source_ref,
      collected_at: input.collected_at,
      medium: input.medium,
      language: input.language,
    },
    consent: { ...input.consent },
    time: {
      observed_at: observedAt,
      precision: input.precision ?? 'minute',
      day_type: dayType,
      service_period: servicePeriod,
    },
    space: {
      h3,
      zone_id: input.cell ?? null,
      network_element: networkElement,
      od_pair: null,
    },
    channels: {
      critical_functional: {
        present: cfPresent,
        problem_class: problemClass,
        severity,
        abstract,
      },
      dramaturgical: {
        narrative_layer: narrativeLayer(input.signal, severity),
        valence: clampRound((input.signal.fiction - input.signal.facts) / 100),
        arousal: clampRound(input.signal.indicators.emotionalMarkers * 2 - 1),
        temporal_tension: clampRound(
          (input.signal.indicators.figurativeMarkers + input.signal.indicators.emotionalMarkers) / 2,
          0, 1,
        ),
      },
    },
    routing: {
      parameter_class: decision.parameter_class,
      parameter_key: decision.parameter_key,
      direction: decision.direction,
      target: decision.target,
      segment: shift ? { label: 'shift_or_fixed_appointment', age_band: null, constraint: 'shift_work' } : null,
      confidence,
      trust_level: trust,
      calibration_eligible: eligible,
      override,
      reason_short: `rule ${decision.rule_id}: ${problemClass} → ${decision.parameter_class} ${decision.direction} ${decision.target}`,
      rule_id: decision.rule_id,
    },
    observation: {
      value: { type: 'ordinal', ordinal: SEVERITY_ORDINAL[severity]! },
      unit: 'severity_1_5',
      uncertainty: Math.round((1 - confidence) * 10000) / 10000,
      weight,
      decay: { half_life_hours: halfLife, t_ref: observedAt, computed_at: now },
      clock: CLASS_CLOCK[decision.parameter_class],
    },
    dialog: dialogBlock({
      instrumented: trust === 'A' || trust === 'B',
      reported: cfPresent,
      model: input.model_check ?? null,
    }),
    links: {
      corroborating: input.reading.correlations.filter((c) => c.verdict === 'confirms').length,
      story_ids: [input.story_id],
      run_id: input.snapshot ? `${input.snapshot.contract}#${input.snapshot.scenario}` : null,
      scenario_id: input.snapshot ? input.snapshot.scenario : null,
      response_ref: null,
    },
    provenance: {
      annotator: {
        engine: 'jev',
        version: EMIT_VERSION,
        model_id: null,
        prompt_hash: null,
        primitive: 'score',
        confidence,
      },
      human_review: input.human_review ?? false,
      reviewer: null,
      reviewed_at: null,
      review_notes: input.review_notes ? `${H3_CONVERSION_NOTE} | ${input.review_notes}` : H3_CONVERSION_NOTE,
    },
  }

  record.content_hash = contentHash(record)

  // --- post-build gates ----------------------------------------------------
  const schema = validateStoryRecord(record)
  if (!schema.ok) return fail('schema', schema.errors.map((e) => `${e.path}: ${e.message}`))

  const invariants = checkInvariants(record)
  if (invariants.consent.length > 0) return fail('consent', invariants.consent)
  if (invariants.invariant.length > 0) return fail('invariant', invariants.invariant)

  return { ok: true, record, jsonl: JSON.stringify(record) }
}

/** narrative_layer from the dominant dramaturgical indicator (fixed order
 *  mirroring avaRead's dramaKey). 'solidarity' is not derivable from the
 *  current indicators — documented as an open mapping (§12). */
function narrativeLayer(signal: StorySignal, severity: number): StoryRecord['channels']['dramaturgical']['narrative_layer'] {
  if (severity >= 4) return 'microcrisis'
  if (signal.indicators.figurativeMarkers >= 0.34) return 'discovery'
  if (signal.indicators.emotionalMarkers >= 0.34) return 'friction'
  return 'solitude'
}

const clampRound = (n: number, min = -1, max = 1) => Math.round(Math.min(max, Math.max(min, n)) * 100) / 100
