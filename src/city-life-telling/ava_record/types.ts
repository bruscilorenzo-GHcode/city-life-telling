/** AVA Story Record v1.0 — TypeScript types mirroring
 *  `schemas/ava-story-record-1.0.json` (JSON Schema 2020-12).
 *
 *  The record carries NO raw citizen text: `source.ref` points into the
 *  story store (localStorage), the record holds only typed annotations and
 *  a de-identified abstract. Field names are the SOR names from the spec
 *  (`critical_functional` / `dramaturgical`); the UI calls the same content
 *  Canale funzionale / Canale fictional (docs/RECON.md §9).
 *
 *  Fail-closed: `validateStoryRecord` rejects missing fields, unknown
 *  fields (I10) and any value outside the schema ranges. */

export type SourceKind = 'request_311' | 'assisted_story' | 'interview' | 'panel' | 'operator_feed'
export type SourceMedium = 'text' | 'voice_transcript' | 'form' | 'sensor'
export type Granularity = 'h3_r7' | 'h3_r8' | 'h3_r9' | 'city'
export type CalibrationUse = 'granted' | 'denied'
export type ConsentRegime = 'socio_narrative' | 'journalistic' | 'touristic'
export type TimePrecision = 'minute' | 'hour' | 'day_part' | 'day'
export type DayType = 'weekday' | 'weekend' | 'event' | 'holiday'
export type ServicePeriod = 'am_peak' | 'midday' | 'pm_peak' | 'evening' | 'night'
export type NetworkElementType = 'link' | 'stop' | 'station' | 'facility' | 'poi' | 'zone'
export type ProblemClass =
  | 'vehicle_full'
  | 'boarding_denied'
  | 'waiting_excessive'
  | 'bunching'
  | 'punctuality'
  | 'infrastructure_condition'
  | 'incident'
  | 'works'
  | 'demand_volume'
  | 'activities_dropped'
  | 'access_lost'
  | 'mode_shift_stated'
  | 'habit_changed'
  | 'perceived_unsafe'
  | 'perceived_crowding'
  | 'other'
  | 'none'
export type Frequency = 'once' | 'occasional' | 'frequent' | 'daily'
export type NarrativeLayer = 'friction' | 'solitude' | 'solidarity' | 'discovery' | 'microcrisis'
export type ParameterClass = 'theta_OD' | 'theta_cap' | 'theta_evt' | 'theta_beh' | 'theta_pers' | 'theta_perc'
export type Direction = 'increase' | 'decrease' | 'both'
export type RouteTarget = 'link' | 'stop' | 'station' | 'facility' | 'od_pair' | 'segment' | 'zone'
export type TrustLevel = 'A' | 'B' | 'C' | 'D' | 'E'
export type SegmentConstraint = 'shift_work' | 'care_duties' | 'reduced_mobility' | 'student' | null
export type ObservationKind = 'scalar' | 'range' | 'ordinal'
export type OrdinalValue = 'none' | 'mild' | 'significant' | 'severe' | null
export type RecordClock = 'minute' | 'day' | 'week' | 'month'
export type DialogState = 'confirmed' | 'blind_spot' | 'silent_problem' | 'normal' | 'pending'
export type AnnotatorEngine = 'jev' | 'llm' | 'human'
export type AnnotatorPrimitive = 'noul' | 'choice' | 'score' | 'match' | 'rerank' | null

export interface SourceBlock {
  kind: SourceKind
  ref: string
  collected_at: string
  medium: SourceMedium
  language: string
}

export interface ConsentBlock {
  geolocation: boolean
  granularity: Granularity
  calibration_use: CalibrationUse
  regime: ConsentRegime
  licence: string
}

export interface TimeBlock {
  observed_at: string
  precision: TimePrecision
  day_type: DayType
  service_period: ServicePeriod
  valid_from?: string | null
  valid_to?: string | null
}

export interface NetworkElement {
  type: NetworkElementType
  id: string
  network_source: string
}

export interface OdPair {
  origin: string
  destination: string
}

export interface SpaceBlock {
  h3: string | null
  zone_id: string | null
  network_element: NetworkElement | null
  od_pair: OdPair | null
}

export interface CriticalFunctional {
  present: boolean
  problem_class: ProblemClass
  severity: number
  frequency?: Frequency
  abstract: string
}

export interface Dramaturgical {
  narrative_layer: NarrativeLayer
  valence: number
  arousal: number
  temporal_tension: number
}

export interface ChannelsBlock {
  critical_functional: CriticalFunctional
  dramaturgical: Dramaturgical
}

export interface RoutingSegment {
  label?: string
  age_band?: string | null
  constraint?: SegmentConstraint
}

export interface RoutingBlock {
  parameter_class: ParameterClass
  parameter_key: string
  direction: Direction
  target: RouteTarget
  segment?: RoutingSegment | null
  confidence: number
  trust_level: TrustLevel
  calibration_eligible: boolean
  override: boolean
  reason_short: string
  rule_id?: number
}

export interface ObservationValue {
  type: ObservationKind
  scalar?: number | null
  low?: number | null
  high?: number | null
  ordinal?: OrdinalValue
}

export interface DecayBlock {
  half_life_hours: number
  t_ref: string
  computed_at?: string
}

export interface ObservationBlock {
  value: ObservationValue
  unit: string
  uncertainty: number
  weight: number
  decay: DecayBlock
  clock: RecordClock
}

export interface ModelCheck {
  run_id: string
  baseline_id: string
  expected: number
  observed: number
  residual: number
  tolerance: number
}

export interface DialogBlock {
  state: DialogState
  model_check: ModelCheck | null
}

export interface LinksBlock {
  corroborating: number
  story_ids: string[]
  run_id: string | null
  scenario_id: string | null
  response_ref: string | null
}

export interface AnnotatorBlock {
  engine: AnnotatorEngine
  version: string
  model_id?: string | null
  prompt_hash?: string | null
  primitive?: AnnotatorPrimitive
  confidence: number
}

export interface ProvenanceBlock {
  annotator: AnnotatorBlock
  human_review: boolean
  reviewer?: string | null
  reviewed_at?: string | null
  review_notes?: string | null
}

export interface StoryRecord {
  schema_version: '1.0'
  record_id: string
  revision: number
  created_at: string
  supersedes?: string | null
  content_hash?: string
  source: SourceBlock
  consent: ConsentBlock
  time: TimeBlock
  space: SpaceBlock
  channels: ChannelsBlock
  routing: RoutingBlock
  observation: ObservationBlock
  dialog: DialogBlock
  links: LinksBlock
  provenance: ProvenanceBlock
}

/* --------------------------------------------------------------- formats */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const H3_RE = /^[0-9a-f]{15}$/
const LANGUAGE_RE = /^[a-z]{2}(-[A-Z]{2})?$/
const HASH_RE = /^sha256:[a-f0-9]{64}$/

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationIssue[]
}

type Dict = Record<string, unknown>

const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)

function err(errors: ValidationIssue[], path: string, message: string): void {
  errors.push({ path, message })
}

function checkString(
  errors: ValidationIssue[],
  path: string,
  value: unknown,
  opts: { pattern?: RegExp, maxLength?: number, format?: 'uuid' | 'date-time' } = {},
): boolean {
  if (typeof value !== 'string') {
    err(errors, path, 'must be a string')
    return false
  }
  if (opts.maxLength !== undefined && value.length > opts.maxLength) {
    err(errors, path, `must be at most ${opts.maxLength} characters`)
    return false
  }
  if (opts.pattern && !opts.pattern.test(value)) {
    err(errors, path, 'does not match the required pattern')
    return false
  }
  if (opts.format === 'uuid' && !UUID_RE.test(value)) {
    err(errors, path, 'must be a UUID')
    return false
  }
  if (opts.format === 'date-time' && (!DATE_TIME_RE.test(value) || Number.isNaN(Date.parse(value)))) {
    err(errors, path, 'must be an ISO date-time')
    return false
  }
  return true
}

function checkEnum(
  errors: ValidationIssue[],
  path: string,
  value: unknown,
  allowed: readonly unknown[],
): boolean {
  if (!allowed.some((option) => option === value)) {
    err(errors, path, `must be one of ${allowed.map(String).join(', ')}`)
    return false
  }
  return true
}

function checkNumber(
  errors: ValidationIssue[],
  path: string,
  value: unknown,
  opts: { min?: number, max?: number, exclusiveMin?: number, integer?: boolean },
): boolean {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    err(errors, path, 'must be a number')
    return false
  }
  if (opts.integer && !Number.isInteger(value)) {
    err(errors, path, 'must be an integer')
    return false
  }
  if (opts.min !== undefined && value < opts.min) {
    err(errors, path, `must be >= ${opts.min}`)
    return false
  }
  if (opts.max !== undefined && value > opts.max) {
    err(errors, path, `must be <= ${opts.max}`)
    return false
  }
  if (opts.exclusiveMin !== undefined && value <= opts.exclusiveMin) {
    err(errors, path, `must be > ${opts.exclusiveMin}`)
    return false
  }
  return true
}

/** Typed, browser-safe validator mirroring the JSON Schema exactly.
 *  `additionalProperties: false` is enforced at every object level, so a
 *  stray `raw_text` field is rejected (I10). */
export function validateStoryRecord(value: unknown): ValidationResult {
  const errors: ValidationIssue[] = []
  if (!isDict(value)) {
    err(errors, '$', 'record must be an object')
    return { ok: false, errors }
  }
  const r = value
  for (const key of Object.keys(r)) {
    if (!['schema_version', 'record_id', 'revision', 'created_at', 'supersedes', 'content_hash',
      'source', 'consent', 'time', 'space', 'channels', 'routing', 'observation', 'dialog',
      'links', 'provenance'].includes(key)) {
      err(errors, `$.${key}`, 'unknown field (additionalProperties)')
    }
  }
  if (r.schema_version !== '1.0') err(errors, '$.schema_version', 'must be "1.0"')
  checkString(errors, '$.record_id', r.record_id, { format: 'uuid' })
  checkNumber(errors, '$.revision', r.revision, { integer: true, min: 1 })
  checkString(errors, '$.created_at', r.created_at, { format: 'date-time' })
  if (r.supersedes !== undefined && r.supersedes !== null) {
    checkString(errors, '$.supersedes', r.supersedes)
  }
  if (r.content_hash !== undefined) {
    checkString(errors, '$.content_hash', r.content_hash, { pattern: HASH_RE })
  }

  // source
  const src = r.source
  if (!isDict(src)) err(errors, '$.source', 'must be an object')
  else {
    for (const key of Object.keys(src)) {
      if (!['kind', 'ref', 'collected_at', 'medium', 'language'].includes(key)) {
        err(errors, `$.source.${key}`, 'unknown field')
      }
    }
    if (!checkEnum(errors, '$.source.kind', src.kind,
      ['request_311', 'assisted_story', 'interview', 'panel', 'operator_feed'])) { /* reported */ }
    checkString(errors, '$.source.ref', src.ref)
    checkString(errors, '$.source.collected_at', src.collected_at, { format: 'date-time' })
    checkEnum(errors, '$.source.medium', src.medium, ['text', 'voice_transcript', 'form', 'sensor'])
    checkString(errors, '$.source.language', src.language, { pattern: LANGUAGE_RE })
  }

  // consent
  const con = r.consent
  if (!isDict(con)) err(errors, '$.consent', 'must be an object')
  else {
    for (const key of Object.keys(con)) {
      if (!['geolocation', 'granularity', 'calibration_use', 'regime', 'licence'].includes(key)) {
        err(errors, `$.consent.${key}`, 'unknown field')
      }
    }
    if (typeof con.geolocation !== 'boolean') err(errors, '$.consent.geolocation', 'must be a boolean')
    checkEnum(errors, '$.consent.granularity', con.granularity, ['h3_r7', 'h3_r8', 'h3_r9', 'city'])
    checkEnum(errors, '$.consent.calibration_use', con.calibration_use, ['granted', 'denied'])
    checkEnum(errors, '$.consent.regime', con.regime, ['socio_narrative', 'journalistic', 'touristic'])
    checkString(errors, '$.consent.licence', con.licence)
  }

  // time
  const time = r.time
  if (!isDict(time)) err(errors, '$.time', 'must be an object')
  else {
    for (const key of Object.keys(time)) {
      if (!['observed_at', 'precision', 'day_type', 'service_period', 'valid_from', 'valid_to'].includes(key)) {
        err(errors, `$.time.${key}`, 'unknown field')
      }
    }
    checkString(errors, '$.time.observed_at', time.observed_at, { format: 'date-time' })
    checkEnum(errors, '$.time.precision', time.precision, ['minute', 'hour', 'day_part', 'day'])
    checkEnum(errors, '$.time.day_type', time.day_type, ['weekday', 'weekend', 'event', 'holiday'])
    checkEnum(errors, '$.time.service_period', time.service_period, ['am_peak', 'midday', 'pm_peak', 'evening', 'night'])
    for (const k of ['valid_from', 'valid_to']) {
      if (time[k] !== undefined && time[k] !== null) {
        checkString(errors, `$.time.${k}`, time[k], { format: 'date-time' })
      }
    }
  }

  // space
  const space = r.space
  if (!isDict(space)) err(errors, '$.space', 'must be an object')
  else {
    for (const key of Object.keys(space)) {
      if (!['h3', 'zone_id', 'network_element', 'od_pair'].includes(key)) {
        err(errors, `$.space.${key}`, 'unknown field')
      }
    }
    if (space.h3 !== null) checkString(errors, '$.space.h3', space.h3, { pattern: H3_RE })
    if (space.zone_id !== null) checkString(errors, '$.space.zone_id', space.zone_id)
    const ne = space.network_element
    if (ne !== null && ne !== undefined) {
      if (!isDict(ne)) err(errors, '$.space.network_element', 'must be an object or null')
      else {
        for (const key of Object.keys(ne)) {
          if (!['type', 'id', 'network_source'].includes(key)) err(errors, `$.space.network_element.${key}`, 'unknown field')
        }
        checkEnum(errors, '$.space.network_element.type', ne.type, ['link', 'stop', 'station', 'facility', 'poi', 'zone'])
        checkString(errors, '$.space.network_element.id', ne.id)
        checkString(errors, '$.space.network_element.network_source', ne.network_source)
      }
    }
    const od = space.od_pair
    if (od !== null && od !== undefined) {
      if (!isDict(od)) err(errors, '$.space.od_pair', 'must be an object or null')
      else {
        for (const key of Object.keys(od)) {
          if (!['origin', 'destination'].includes(key)) err(errors, `$.space.od_pair.${key}`, 'unknown field')
        }
        checkString(errors, '$.space.od_pair.origin', od.origin)
        checkString(errors, '$.space.od_pair.destination', od.destination)
      }
    }
  }

  // channels
  const ch = r.channels
  if (!isDict(ch)) err(errors, '$.channels', 'must be an object')
  else {
    for (const key of Object.keys(ch)) {
      if (!['critical_functional', 'dramaturgical'].includes(key)) err(errors, `$.channels.${key}`, 'unknown field')
    }
    const cf = ch.critical_functional
    if (!isDict(cf)) err(errors, '$.channels.critical_functional', 'must be an object')
    else {
      for (const key of Object.keys(cf)) {
        if (!['present', 'problem_class', 'severity', 'frequency', 'abstract'].includes(key)) {
          err(errors, `$.channels.critical_functional.${key}`, 'unknown field')
        }
      }
      if (typeof cf.present !== 'boolean') err(errors, '$.channels.critical_functional.present', 'must be a boolean')
      checkEnum(errors, '$.channels.critical_functional.problem_class', cf.problem_class, PROBLEM_CLASSES)
      checkNumber(errors, '$.channels.critical_functional.severity', cf.severity, { integer: true, min: 1, max: 5 })
      if (cf.frequency !== undefined) {
        checkEnum(errors, '$.channels.critical_functional.frequency', cf.frequency, ['once', 'occasional', 'frequent', 'daily'])
      }
      checkString(errors, '$.channels.critical_functional.abstract', cf.abstract, { maxLength: 400 })
    }
    const dr = ch.dramaturgical
    if (!isDict(dr)) err(errors, '$.channels.dramaturgical', 'must be an object')
    else {
      for (const key of Object.keys(dr)) {
        if (!['narrative_layer', 'valence', 'arousal', 'temporal_tension'].includes(key)) {
          err(errors, `$.channels.dramaturgical.${key}`, 'unknown field')
        }
      }
      checkEnum(errors, '$.channels.dramaturgical.narrative_layer', dr.narrative_layer,
        ['friction', 'solitude', 'solidarity', 'discovery', 'microcrisis'])
      checkNumber(errors, '$.channels.dramaturgical.valence', dr.valence, { min: -1, max: 1 })
      checkNumber(errors, '$.channels.dramaturgical.arousal', dr.arousal, { min: -1, max: 1 })
      checkNumber(errors, '$.channels.dramaturgical.temporal_tension', dr.temporal_tension, { min: 0, max: 1 })
    }
  }

  // routing
  const ro = r.routing
  if (!isDict(ro)) err(errors, '$.routing', 'must be an object')
  else {
    for (const key of Object.keys(ro)) {
      if (!['parameter_class', 'parameter_key', 'direction', 'target', 'segment', 'confidence',
        'trust_level', 'calibration_eligible', 'override', 'reason_short', 'rule_id'].includes(key)) {
        err(errors, `$.routing.${key}`, 'unknown field')
      }
    }
    checkEnum(errors, '$.routing.parameter_class', ro.parameter_class,
      ['theta_OD', 'theta_cap', 'theta_evt', 'theta_beh', 'theta_pers', 'theta_perc'])
    checkString(errors, '$.routing.parameter_key', ro.parameter_key)
    checkEnum(errors, '$.routing.direction', ro.direction, ['increase', 'decrease', 'both'])
    checkEnum(errors, '$.routing.target', ro.target, ['link', 'stop', 'station', 'facility', 'od_pair', 'segment', 'zone'])
    const seg = ro.segment
    if (seg !== null && seg !== undefined) {
      if (!isDict(seg)) err(errors, '$.routing.segment', 'must be an object or null')
      else {
        for (const key of Object.keys(seg)) {
          if (!['label', 'age_band', 'constraint'].includes(key)) err(errors, `$.routing.segment.${key}`, 'unknown field')
        }
        if (seg.label !== undefined) checkString(errors, '$.routing.segment.label', seg.label)
        if (seg.age_band !== undefined && seg.age_band !== null) checkString(errors, '$.routing.segment.age_band', seg.age_band)
        if (seg.constraint !== undefined) {
          checkEnum(errors, '$.routing.segment.constraint', seg.constraint,
            ['shift_work', 'care_duties', 'reduced_mobility', 'student', null])
        }
      }
    }
    checkNumber(errors, '$.routing.confidence', ro.confidence, { min: 0, max: 1 })
    checkEnum(errors, '$.routing.trust_level', ro.trust_level, ['A', 'B', 'C', 'D', 'E'])
    if (typeof ro.calibration_eligible !== 'boolean') err(errors, '$.routing.calibration_eligible', 'must be a boolean')
    if (typeof ro.override !== 'boolean') err(errors, '$.routing.override', 'must be a boolean')
    checkString(errors, '$.routing.reason_short', ro.reason_short, { maxLength: 200 })
    if (ro.rule_id !== undefined) checkNumber(errors, '$.routing.rule_id', ro.rule_id, { integer: true, min: 1, max: 12 })
  }

  // observation
  const ob = r.observation
  if (!isDict(ob)) err(errors, '$.observation', 'must be an object')
  else {
    for (const key of Object.keys(ob)) {
      if (!['value', 'unit', 'uncertainty', 'weight', 'decay', 'clock'].includes(key)) {
        err(errors, `$.observation.${key}`, 'unknown field')
      }
    }
    const val = ob.value
    if (!isDict(val)) err(errors, '$.observation.value', 'must be an object')
    else {
      for (const key of Object.keys(val)) {
        if (!['type', 'scalar', 'low', 'high', 'ordinal'].includes(key)) err(errors, `$.observation.value.${key}`, 'unknown field')
      }
      checkEnum(errors, '$.observation.value.type', val.type, ['scalar', 'range', 'ordinal'])
      if (val.scalar !== undefined && val.scalar !== null) checkNumber(errors, '$.observation.value.scalar', val.scalar, {})
      if (val.low !== undefined && val.low !== null) checkNumber(errors, '$.observation.value.low', val.low, {})
      if (val.high !== undefined && val.high !== null) checkNumber(errors, '$.observation.value.high', val.high, {})
      if (val.ordinal !== undefined) {
        checkEnum(errors, '$.observation.value.ordinal', val.ordinal, ['none', 'mild', 'significant', 'severe', null])
      }
    }
    checkString(errors, '$.observation.unit', ob.unit)
    checkNumber(errors, '$.observation.uncertainty', ob.uncertainty, { min: 0 })
    checkNumber(errors, '$.observation.weight', ob.weight, { min: 0, max: 1 })
    const dec = ob.decay
    if (!isDict(dec)) err(errors, '$.observation.decay', 'must be an object')
    else {
      for (const key of Object.keys(dec)) {
        if (!['half_life_hours', 't_ref', 'computed_at'].includes(key)) err(errors, `$.observation.decay.${key}`, 'unknown field')
      }
      checkNumber(errors, '$.observation.decay.half_life_hours', dec.half_life_hours, { exclusiveMin: 0 })
      checkString(errors, '$.observation.decay.t_ref', dec.t_ref, { format: 'date-time' })
      if (dec.computed_at !== undefined) checkString(errors, '$.observation.decay.computed_at', dec.computed_at, { format: 'date-time' })
    }
    checkEnum(errors, '$.observation.clock', ob.clock, ['minute', 'day', 'week', 'month'])
  }

  // dialog
  const di = r.dialog
  if (!isDict(di)) err(errors, '$.dialog', 'must be an object')
  else {
    for (const key of Object.keys(di)) {
      if (!['state', 'model_check'].includes(key)) err(errors, `$.dialog.${key}`, 'unknown field')
    }
    checkEnum(errors, '$.dialog.state', di.state, ['confirmed', 'blind_spot', 'silent_problem', 'normal', 'pending'])
    const mc = di.model_check
    if (mc !== null) {
      if (!isDict(mc)) err(errors, '$.dialog.model_check', 'must be an object or null')
      else {
        for (const key of Object.keys(mc)) {
          if (!['run_id', 'baseline_id', 'expected', 'observed', 'residual', 'tolerance'].includes(key)) {
            err(errors, `$.dialog.model_check.${key}`, 'unknown field')
          }
        }
        checkString(errors, '$.dialog.model_check.run_id', mc.run_id)
        checkString(errors, '$.dialog.model_check.baseline_id', mc.baseline_id)
        checkNumber(errors, '$.dialog.model_check.expected', mc.expected, {})
        checkNumber(errors, '$.dialog.model_check.observed', mc.observed, {})
        checkNumber(errors, '$.dialog.model_check.residual', mc.residual, {})
        checkNumber(errors, '$.dialog.model_check.tolerance', mc.tolerance, { min: 0 })
      }
    }
  }

  // links
  const li = r.links
  if (!isDict(li)) err(errors, '$.links', 'must be an object')
  else {
    for (const key of Object.keys(li)) {
      if (!['corroborating', 'story_ids', 'run_id', 'scenario_id', 'response_ref'].includes(key)) {
        err(errors, `$.links.${key}`, 'unknown field')
      }
    }
    checkNumber(errors, '$.links.corroborating', li.corroborating, { integer: true, min: 0 })
    if (!Array.isArray(li.story_ids)) err(errors, '$.links.story_ids', 'must be an array')
    else li.story_ids.forEach((id, i) => checkString(errors, `$.links.story_ids[${i}]`, id))
    for (const k of ['run_id', 'scenario_id', 'response_ref']) {
      if (li[k] !== null) checkString(errors, `$.links.${k}`, li[k])
    }
  }

  // provenance
  const pr = r.provenance
  if (!isDict(pr)) err(errors, '$.provenance', 'must be an object')
  else {
    for (const key of Object.keys(pr)) {
      if (!['annotator', 'human_review', 'reviewer', 'reviewed_at', 'review_notes'].includes(key)) {
        err(errors, `$.provenance.${key}`, 'unknown field')
      }
    }
    const an = pr.annotator
    if (!isDict(an)) err(errors, '$.provenance.annotator', 'must be an object')
    else {
      for (const key of Object.keys(an)) {
        if (!['engine', 'version', 'model_id', 'prompt_hash', 'primitive', 'confidence'].includes(key)) {
          err(errors, `$.provenance.annotator.${key}`, 'unknown field')
        }
      }
      checkEnum(errors, '$.provenance.annotator.engine', an.engine, ['jev', 'llm', 'human'])
      checkString(errors, '$.provenance.annotator.version', an.version)
      for (const k of ['model_id', 'prompt_hash']) {
        if (an[k] !== undefined && an[k] !== null) checkString(errors, `$.provenance.annotator.${k}`, an[k])
      }
      if (an.primitive !== undefined) {
        checkEnum(errors, '$.provenance.annotator.primitive', an.primitive,
          ['noul', 'choice', 'score', 'match', 'rerank', null])
      }
      checkNumber(errors, '$.provenance.annotator.confidence', an.confidence, { min: 0, max: 1 })
    }
    if (typeof pr.human_review !== 'boolean') err(errors, '$.provenance.human_review', 'must be a boolean')
    for (const k of ['reviewer', 'review_notes']) {
      if (pr[k] !== undefined && pr[k] !== null) checkString(errors, `$.provenance.${k}`, pr[k])
    }
    if (pr.reviewed_at !== undefined && pr.reviewed_at !== null) {
      checkString(errors, '$.provenance.reviewed_at', pr.reviewed_at, { format: 'date-time' })
    }
  }

  return { ok: errors.length === 0, errors }
}

export const PROBLEM_CLASSES: readonly ProblemClass[] = [
  'vehicle_full', 'boarding_denied', 'waiting_excessive', 'bunching', 'punctuality',
  'infrastructure_condition', 'incident', 'works', 'demand_volume', 'activities_dropped',
  'access_lost', 'mode_shift_stated', 'habit_changed', 'perceived_unsafe', 'perceived_crowding',
  'other', 'none',
]
