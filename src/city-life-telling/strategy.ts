/** CITY-LIFE-TELLING — the decision model (deterministic strategy matrix).
 *
 *  Chosen approach, stated: a **deterministic, explainable decision matrix**
 *  crossing two inputs — the weather forecast (`clt.weather.v0`) and the
 *  traffic congestion state of the MATSim snapshot — NOT a statistical/ML
 *  model and NOT a raw LLM call. Reasons: it runs offline on-device, it is
 *  reproducible and auditable (EU AI Act advisory posture, like the rest of
 *  AVA), it degrades gracefully when a feed is missing, and each rule maps
 *  to an operational playbook the curators can defend. An LLM strategy
 *  writer can later rephrase the same structured strategies; the matrix
 *  stays the source of truth.
 *
 *  Every strategy carries a priority score 0..100, a horizon, target lines
 *  and the factor trail. The output is ADVISORY: the Urban Strategist
 *  decides, the model never acts. */

import { SEED_LINES } from './matsim/network.js'
import type { MatsimSnapshot } from './matsim/types.js'
import { forecastStress, type WeatherForecast } from './weather.js'

export type StrategyId =
  | 'winter-ops' | 'storm-advisory' | 'congestion-relief'
  | 'shuttle-bridge' | 'thermal-points' | 'story-call' | 'story-gap'

export type StrategyHorizon = 'now' | 'today' | 'days'

export interface Strategy {
  id: StrategyId
  /** Priority 0..100, sorted descending in the output. */
  score: number
  horizon: StrategyHorizon
  targetLines: string[]
  params: Record<string, string | number>
  factors: string[]
}

export interface DecisionContext {
  /** Stories currently on the wall — recency and sentiment of the community. */
  storyCount: number
  /** Stories AVA marked as diverging from the simulation. */
  divergingCount: number
}

function lineLabel(lineId: string): string {
  return SEED_LINES.find((l) => l.id === lineId)?.label ?? lineId
}

/** Full pass: weather × congestion × community. Deterministic. */
export function decideStrategies(
  snapshot: MatsimSnapshot | null,
  forecast: WeatherForecast | null,
  context: DecisionContext,
): Strategy[] {
  const strategies: Strategy[] = []
  const lines = snapshot?.lines ?? []
  const stress = forecast ? forecastStress(forecast) : 0
  const worst = forecast?.periods[0] ?? null
  const congestion = lines.map((l) => l.load)
  const avgLoad = congestion.length > 0
    ? congestion.reduce((a, n) => a + n, 0) / congestion.length
    : 0
  const disrupted = [...lines].sort((a, b) => b.load * b.avgDelaySec - a.load * a.avgDelaySec)
  const busiest = disrupted.slice(0, 2)
  const incidentLines = lines.filter((l) => l.incidents.length > 0)
  const storyCell = busiest[0]?.lineId
    ? SEED_LINES.find((l) => l.id === busiest[0]!.lineId)?.stops[0]?.name ?? ''
    : ''

  // 1 · WINTER OPS — snow/ice stress + cold season: crews and lanes first.
  // Severe weather outranks routine congestion relief: safety before speed.
  if (worst && (worst.precipKind === 'snow' || worst.precipKind === 'freezing') && stress >= 0.45) {
    strategies.push({
      id: 'winter-ops',
      score: Math.round(68 + 28 * stress + 8 * avgLoad),
      horizon: 'now',
      targetLines: busiest.map((l) => l.lineId),
      params: {
        lines: busiest.map((l) => lineLabel(l.lineId)).join(' · '),
        precip: worst.precipKind === 'snow' ? 'snow' : 'freezing rain',
      },
      factors: [
        `precip:${worst.precipKind}+${worst.precipMm}mm`,
        `stress:${stress.toFixed(2)}`,
        `avg_load:${avgLoad.toFixed(2)}`,
      ],
    })
  }

  // 2 · STORM / WIND ADVISORY — protect people before punctuality.
  if (worst && (worst.alert === 'storm' || worst.alert === 'wind') && stress >= 0.5) {
    strategies.push({
      id: 'storm-advisory',
      score: Math.round(58 + 32 * stress),
      horizon: 'now',
      targetLines: busiest.map((l) => l.lineId),
      params: { lines: busiest.map((l) => lineLabel(l.lineId)).join(' · '), wind: worst.windKmh },
      factors: [`alert:${worst.alert}`, `wind:${worst.windKmh}km/h`, `stress:${stress.toFixed(2)}`],
    })
  }

  // 3 · CONGESTION RELIEF — extra vehicles where load and delay co-occur.
  const jammed = lines
    .filter((l) => l.load >= 0.7 && l.avgDelaySec >= 180)
    .sort((a, b) => b.load * 1000 + b.avgDelaySec - (a.load * 1000 + a.avgDelaySec))
    .slice(0, 2)
  if (jammed.length > 0) {
    strategies.push({
      id: 'congestion-relief',
      score: Math.round(46 + 40 * Math.max(...jammed.map((l) => l.load)) + 8 * (stress > 0 ? 1 : 0)),
      horizon: 'today',
      targetLines: jammed.map((l) => l.lineId),
      params: {
        lines: jammed.map((l) => lineLabel(l.lineId)).join(' · '),
        load: Math.round(Math.max(...jammed.map((l) => l.load)) * 100),
        delay: Math.max(...jammed.map((l) => l.avgDelaySec)),
      },
      factors: [
        ...jammed.map((l) => `${l.lineId}:load${Math.round(l.load * 100)}%+delay${l.avgDelaySec}s`),
        `weather_amplifier:${stress > 0.45 ? 'yes' : 'no'}`,
      ],
    })
  }

  // 4 · SHUTTLE BRIDGE — incident on a loaded corridor.
  const bridged = incidentLines
    .filter((l) => l.load >= 0.35 && (l.status === 'disrupted' || l.status === 'suspended'))
    .slice(0, 1)
  for (const line of bridged) {
    const stops = SEED_LINES.find((l) => l.id === line.lineId)?.stops ?? []
    const first = stops[0]?.name ?? ''
    const last = stops[stops.length - 1]?.name ?? ''
    strategies.push({
      id: 'shuttle-bridge',
      score: Math.round(48 + 30 * line.load + 14 * (line.incidents[0]?.severity ?? 0)),
      horizon: 'now',
      targetLines: [line.lineId],
      params: { corridor: `${first} ↔ ${last}` },
      factors: [
        `incident:${line.incidents[0]?.kind ?? 'unknown'}`,
        `load:${Math.round(line.load * 100)}%`,
        `status:${line.status}`,
      ],
    })
  }

  // 5 · THERMAL POINTS — health of citizens at interchanges.
  if (worst && (worst.tempC <= -18 || worst.tempC >= 30)) {
    strategies.push({
      id: 'thermal-points',
      score: Math.round(45 + 30 * stress),
      horizon: 'today',
      targetLines: busiest.slice(0, 1).map((l) => l.lineId),
      params: { kind: worst.tempC <= -18 ? 'riscaldati/warm' : 'raffrescati/cool' },
      factors: [`temp:${worst.tempC}°C`, `stress:${stress.toFixed(2)}`],
    })
  }

  // 6 · STORY CALL — dramaturgical sociality as a sensing instrument.
  if (stress >= 0.4 && storyCell) {
    strategies.push({
      id: 'story-call',
      score: Math.round(40 + 25 * stress + Math.min(15, context.storyCount)),
      horizon: 'today',
      targetLines: busiest.slice(0, 1).map((l) => l.lineId),
      params: { cell: storyCell },
      factors: [
        `weather_stress:${stress.toFixed(2)}`,
        `stories_on_wall:${context.storyCount}`,
        `target:${busiest[0]?.lineId ?? 'n/a'}`,
      ],
    })
  }

  // 7 · STORY GAP — diverging stories are signal: publish the diff.
  if (context.divergingCount >= 2) {
    strategies.push({
      id: 'story-gap',
      score: Math.round(36 + 8 * context.divergingCount),
      horizon: 'days',
      targetLines: [],
      params: { count: context.divergingCount },
      factors: [`diverging_stories:${context.divergingCount}`, 'total_stories:' + context.storyCount],
    })
  }

  return strategies.sort((a, b) => b.score - a.score).slice(0, 5)
}
