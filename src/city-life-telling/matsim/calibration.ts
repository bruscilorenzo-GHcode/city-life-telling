/** CITY-LIFE-TELLING — parametric calibration of the MATSim input.
 *
 *  The simulation feed (simulated or live bridge) is not taken as-is: it is
 *  **calibrated** by the Urban Strategist through four temporal clocks —
 *  hour, day, week, month — plus demand, congestion sensitivity, a focus
 *  area and an agent budget. Everything is deterministic and explainable:
 *  the effective multiplier is the product of the four clock curves, each
 *  blended by its own weight, and the result is written into the snapshot
 *  `meta` so a session can be replayed and audited.
 *
 *  Computational effort is contained by a **focus area** (a jam-prone
 *  polygon approximation: centre + radius) and a hard **agent budget**:
 *  only agents inside the focus are generated and rendered. */

import { SEED_LINES } from './network.js'
import {
  statusForDelay,
  type MatsimSnapshot,
  type ServiceStatus,
} from './types.js'

export type ClockKey = 'hour' | 'day' | 'week' | 'month'
export type ClockEmphasis = ClockKey | 'custom'
/** Instrument view scope: the jam-prone focus (detail) or the whole city
 *  (density field + a capped agent sample — see the console renderer). */
export type CalibrationScope = 'focus' | 'city'

export interface ClockWeights {
  hour: number
  day: number
  week: number
  month: number
}

export interface FocusArea {
  id: string
  label: string
  lat: number
  lon: number
  radiusKm: number
}

export interface CalibrationConfig {
  demand: number
  clocks: ClockWeights
  emphasis: ClockEmphasis
  congestionSensitivity: number
  focus: FocusArea
  scope: CalibrationScope
  agentBudget: number
  seed: number
}

export const CALIBRATION_KEY = 'city-life-telling.calibration.v1'
export const AGENT_BUDGET_MIN = 24
/** Detailed focus view. */
export const AGENT_BUDGET_MAX = 800
/** City view: a declared sample, capped — a full agent render would need GPU.
 *  3k points on a plain 2D canvas is the honest ceiling. */
export const CITY_AGENT_BUDGET_MAX = 3000
/** Cell size of the city-wide density field (≈ 1.1 km at this latitude). */
export const DENSITY_CELL_DEG = 0.012

/** Dense, jam-prone areas of the seed network. */
export const FOCUS_PRESETS: FocusArea[] = [
  { id: 'centre_ville', label: 'Centre-ville · Berri-UQAM', lat: 45.5152, lon: -73.5613, radiusKm: 2 },
  { id: 'jean_talon', label: 'Jean-Talon', lat: 45.5386, lon: -73.6192, radiusKm: 1.8 },
  { id: 'pie_ix', label: 'Corridoio Pie-IX', lat: 45.545, lon: -73.55, radiusKm: 2.2 },
  { id: 'laval', label: 'Montmorency · Laval', lat: 45.606, lon: -73.7118, radiusKm: 2.4 },
]

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  demand: 1,
  clocks: { hour: 1, day: 1, week: 0.6, month: 0.6 },
  emphasis: 'custom',
  congestionSensitivity: 1,
  focus: { ...FOCUS_PRESETS[0]! },
  scope: 'focus',
  agentBudget: 240,
  seed: 20261105,
}

/** Frame presets: pick which clock dominates the calibration. */
export const EMPHASIS_PRESETS: Record<ClockKey, ClockWeights> = {
  hour: { hour: 1.6, day: 0.4, week: 0.2, month: 0.2 },
  day: { hour: 0.4, day: 1.6, week: 0.3, month: 0.2 },
  week: { hour: 0.3, day: 0.4, week: 1.6, month: 0.3 },
  month: { hour: 0.2, day: 0.3, week: 0.4, month: 1.6 },
}

/* ------------------------------------------------------------- the clocks */

/** Montréal local hour (UTC−5), 0..24. */
function localHour(when: Date): number {
  return ((when.getUTCHours() - 5 + 24) % 24) + when.getUTCMinutes() / 60
}

function localDate(when: Date): Date {
  return new Date(when.getTime() - 5 * 3600 * 1000)
}

export function hourCurve(when: Date): number {
  const hour = localHour(when)
  const morning = Math.exp(-((hour - 8.2) ** 2) / 2.2)
  const evening = Math.exp(-((hour - 17.4) ** 2) / 2.6)
  return Number((0.45 + 0.75 * morning + 0.8 * evening).toFixed(3))
}

export function dayCurve(when: Date): number {
  const day = localDate(when).getUTCDay() // 0 Sun … 6 Sat
  if (day === 0) return 0.62
  if (day === 6) return 0.78
  if (day === 5) return 1.08
  return 1
}

export function weekCurve(when: Date, seed = DEFAULT_CALIBRATION.seed): number {
  const week = Math.floor(when.getTime() / (7 * 86400000))
  const hash = Math.abs(Math.sin((week + seed) * 12.9898) * 43758.5453) % 1
  return Number((0.94 + 0.12 * hash).toFixed(3))
}

export function monthCurve(when: Date): number {
  const month = localDate(when).getUTCMonth() + 1 // 1..12
  return Number((1 + 0.12 * Math.cos(((month - 0.5) / 12) * 2 * Math.PI)).toFixed(3))
}

export interface ClockBreakdown {
  hour: number
  day: number
  week: number
  month: number
  effective: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Effective demand multiplier, product of the four blended clocks. */
export function temporalMultiplier(cfg: CalibrationConfig, when: Date): number {
  return clockBreakdown(cfg, when).effective
}

export function clockBreakdown(cfg: CalibrationConfig, when: Date): ClockBreakdown {
  const hour = hourCurve(when)
  const day = dayCurve(when)
  const week = weekCurve(when, cfg.seed)
  const month = monthCurve(when)
  const blend = (curve: number, weight: number) => 1 + clamp(weight, 0, 2) * (curve - 1)
  const effective = clamp(
    clamp(cfg.demand, 0.2, 3) * blend(hour, cfg.clocks.hour) * blend(day, cfg.clocks.day)
      * blend(week, cfg.clocks.week) * blend(month, cfg.clocks.month),
    0.15,
    4,
  )
  return {
    hour: Number(blend(hour, cfg.clocks.hour).toFixed(2)),
    day: Number(blend(day, cfg.clocks.day).toFixed(2)),
    week: Number(blend(week, cfg.clocks.week).toFixed(2)),
    month: Number(blend(month, cfg.clocks.month).toFixed(2)),
    effective: Number(effective.toFixed(2)),
  }
}

/* ------------------------------------------------------------- the focus */

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export function inFocus(focus: FocusArea, lat: number, lon: number): boolean {
  return distanceKm(focus.lat, focus.lon, lat, lon) <= focus.radiusKm
}

/** Lines whose geometry crosses the focus area. */
export function linesInFocus(focus: FocusArea): string[] {
  return SEED_LINES
    .filter((line) => line.stops.some((stop) => inFocus(focus, stop.lat, stop.lon)))
    .map((line) => line.id)
}

/* --------------------------------------------------- calibrated snapshots */

function severity(delay: number): ServiceStatus {
  if (delay >= 420) return 'disrupted'
  if (delay >= 180) return 'delayed'
  if (delay >= 60) return 'irregular'
  return 'nominal'
}

/** Applies demand, congestion sensitivity and clock weights to a snapshot.
 *  Pure and deterministic: same snapshot + config + time ⇒ same result. */
export function applyCalibration(snapshot: MatsimSnapshot, cfg: CalibrationConfig, when: Date): MatsimSnapshot {
  const breakdown = clockBreakdown(cfg, when)
  const factor = breakdown.effective
  const sensitivity = clamp(cfg.congestionSensitivity, 0.2, 2)
  const lines = snapshot.lines.map((state) => {
    const base = SEED_LINES.find((line) => line.id === state.lineId)
    const avgDelaySec = Math.max(-30, Math.round(state.avgDelaySec * sensitivity * factor))
    const headwayMin = Number(Math.max(0.5, state.headwayMin / Math.max(0.4, factor ** 0.35)).toFixed(1))
    const load = Number(clamp(state.load * factor ** 0.9, 0.02, 1).toFixed(2))
    const activeAgents = Math.max(0, Math.round(state.activeAgents * factor))
    const status = severity(avgDelaySec) === 'nominal' && base
      ? statusForDelay(avgDelaySec, headwayMin / base.baseHeadwayMin)
      : severity(avgDelaySec)
    return { ...state, status, avgDelaySec, headwayMin, load, activeAgents }
  })
  const onboard = lines.reduce((sum, line) => sum + line.activeAgents, 0)
  return {
    ...snapshot,
    lines,
    agents: {
      onboard,
      waiting: Math.round(snapshot.agents.waiting * factor),
      avgTripMin: Number((snapshot.agents.avgTripMin * clamp(0.8 + 0.2 * factor, 0.8, 1.6)).toFixed(1)),
    },
    meta: {
      ...(snapshot.meta ?? {}),
      calibration_demand: cfg.demand,
      calibration_emphasis: cfg.emphasis,
      calibration_clock_hour: breakdown.hour,
      calibration_clock_day: breakdown.day,
      calibration_clock_week: breakdown.week,
      calibration_clock_month: breakdown.month,
      calibration_factor: breakdown.effective,
      calibration_focus: cfg.focus.label,
      calibration_focus_km: cfg.focus.radiusKm,
      calibration_scope: cfg.scope,
      calibration_agent_budget: cfg.agentBudget,
    },
  }
}

/* --------------------------------------------------------------- storage */

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem'>

export function sanitizeCalibration(raw: unknown): CalibrationConfig {
  const input = (raw ?? {}) as Partial<CalibrationConfig>
  const scope: CalibrationScope = input.scope === 'city' ? 'city' : 'focus'
  const budgetMax = scope === 'city' ? CITY_AGENT_BUDGET_MAX : AGENT_BUDGET_MAX
  const clocks = (input.clocks ?? {}) as Partial<ClockWeights>
  const focus = (input.focus ?? {}) as Partial<FocusArea>
  const num = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback
  return {
    demand: num(input.demand, DEFAULT_CALIBRATION.demand, 0.2, 3),
    clocks: {
      hour: num(clocks.hour, 1, 0, 2),
      day: num(clocks.day, 1, 0, 2),
      week: num(clocks.week, 0.6, 0, 2),
      month: num(clocks.month, 0.6, 0, 2),
    },
    emphasis: input.emphasis === 'hour' || input.emphasis === 'day' || input.emphasis === 'week' || input.emphasis === 'month'
      ? input.emphasis
      : 'custom',
    congestionSensitivity: num(input.congestionSensitivity, 1, 0.2, 2),
    focus: {
      id: typeof focus.id === 'string' ? focus.id.slice(0, 40) : DEFAULT_CALIBRATION.focus.id,
      label: typeof focus.label === 'string' ? focus.label.slice(0, 60) : DEFAULT_CALIBRATION.focus.label,
      lat: num(focus.lat, DEFAULT_CALIBRATION.focus.lat, -90, 90),
      lon: num(focus.lon, DEFAULT_CALIBRATION.focus.lon, -180, 180),
      radiusKm: num(focus.radiusKm, DEFAULT_CALIBRATION.focus.radiusKm, 0.5, 5),
    },
    scope,
    agentBudget: Math.round(num(input.agentBudget, DEFAULT_CALIBRATION.agentBudget, AGENT_BUDGET_MIN, budgetMax)),
    seed: Math.round(num(input.seed, DEFAULT_CALIBRATION.seed, 0, 2 ** 31 - 1)),
  }
}

export function loadCalibration(storage: ReadStorage | null | undefined): CalibrationConfig {
  try {
    const raw = storage?.getItem(CALIBRATION_KEY)
    return raw ? sanitizeCalibration(JSON.parse(raw)) : DEFAULT_CALIBRATION
  } catch {
    return DEFAULT_CALIBRATION
  }
}

export function saveCalibration(cfg: CalibrationConfig, storage: WriteStorage | null | undefined): void {
  if (!storage) return
  try {
    storage.setItem(CALIBRATION_KEY, JSON.stringify(sanitizeCalibration(cfg)))
  } catch {
    // ignore
  }
}
