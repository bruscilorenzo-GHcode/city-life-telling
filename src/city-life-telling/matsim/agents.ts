/** CITY-LIFE-TELLING — geolocalised MATSim agents (current, visualised).
 *
 *  The MAP shows the agents themselves, not only line aggregates: vehicles
 *  moving along the line geometry, **only inside the calibration focus
 *  area** and capped by the **agent budget**, so the computational effort
 *  stays bounded on the jam-prone area under study.
 *
 *  Deterministic: agents are a pure function of (calibrated snapshot, config,
 *  tick). Rendering animates them between ticks with `progress + speed · dt`,
 *  so the movement is smooth without extra simulation steps. */

import { hash01 } from './simulated-source.js'
import { CITY_AGENT_BUDGET_MAX, DENSITY_CELL_DEG, inFocus, type CalibrationConfig } from './calibration.js'
import { SEED_LINES } from './network.js'
import type { MatsimSnapshot } from './types.js'

export interface SimAgent {
  id: string
  lineId: string
  /** Progress along the line, 0..1. */
  progress: number
  /** Direction along the line: 1 forward, -1 backward. */
  direction: 1 | -1
  /** Fraction of the line per second (for on-screen animation). */
  speed: number
  lat: number
  lon: number
}

interface Segment {
  a: [number, number]
  b: [number, number]
  length: number
}

function lineSegments(lineId: string): Segment[] {
  const line = SEED_LINES.find((l) => l.id === lineId)
  if (!line) return []
  const segments: Segment[] = []
  for (let i = 0; i < line.stops.length - 1; i += 1) {
    const a = line.stops[i]!
    const b = line.stops[i + 1]!
    const length = Math.hypot(b.lat - a.lat, b.lon - a.lon)
    segments.push({ a: [a.lat, a.lon], b: [b.lat, b.lon], length })
  }
  return segments
}

/** Point at a normalized progress along the line polyline. */
export function positionAlong(lineId: string, progress: number): [number, number] {
  const segments = lineSegments(lineId)
  if (segments.length === 0) return [0, 0]
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  if (total === 0) return segments[0]!.a
  // progress 1 is the terminus; other values wrap for the animation.
  const normalized = progress === 1 ? 1 : ((progress % 1) + 1) % 1
  let remaining = normalized * total
  for (const segment of segments) {
    if (remaining <= segment.length || segment === segments[segments.length - 1]) {
      const t = segment.length === 0 ? 0 : Math.min(1, remaining / segment.length)
      return [
        segment.a[0] + (segment.b[0] - segment.a[0]) * t,
        segment.a[1] + (segment.b[1] - segment.a[1]) * t,
      ]
    }
    remaining -= segment.length
  }
  return segments[segments.length - 1]!.b
}

/** Generate the current agents: inside the focus (detail view) or across the
 *  whole city (declared sample), capped by the budget and proportional to
 *  each line's calibrated load. */
export function generateAgents(snapshot: MatsimSnapshot, cfg: CalibrationConfig, tick: number): SimAgent[] {
  const cityScope = cfg.scope === 'city'
  const cap = cityScope ? CITY_AGENT_BUDGET_MAX : 800
  const budget = Math.max(0, Math.min(cfg.agentBudget, cap, snapshot.lines.length * 400))
  // Desired per line ∝ calibrated agents on the line; cheap containment first.
  const weights = snapshot.lines.map((state) => ({
    state,
    desired: Math.max(0, state.activeAgents) / 60,
  }))
  const totalDesired = weights.reduce((sum, w) => sum + w.desired, 0)
  if (totalDesired === 0) return []
  const scale = Math.min(1, budget / totalDesired)

  const agents: SimAgent[] = []
  weights.forEach(({ state, desired }, lineIndex) => {
    const count = Math.floor(desired * scale)
    for (let i = 0; i < count && agents.length < budget; i += 1) {
      // Detail view: rejection-sample until the point is inside the focus.
      // City view: sample anywhere along the line (no rejection needed).
      let progress = 0
      let lat = 0
      let lon = 0
      let found = cityScope
      for (let attempt = 0; attempt < 8; attempt += 1) {
        progress = hash01(cfg.seed, tick, lineIndex, i, attempt, 11)
        ;[lat, lon] = positionAlong(state.lineId, progress)
        if (cityScope || inFocus(cfg.focus, lat, lon)) { found = true; break }
      }
      if (!found) continue
      const direction: 1 | -1 = hash01(cfg.seed, tick, lineIndex, i, 12) < 0.5 ? 1 : -1
      const statusPenalty = state.status === 'suspended' ? 0.15
        : state.status === 'disrupted' ? 0.4
          : state.status === 'delayed' ? 0.7
            : 1
      const speed = Number(((0.015 + 0.045 * hash01(cfg.seed, tick, lineIndex, i, 13)) * statusPenalty).toFixed(4))
      agents.push({
        id: `ag_${state.lineId}_${tick}_${i}`,
        lineId: state.lineId,
        progress,
        direction,
        speed,
        lat,
        lon,
      })
    }
  })
  return agents
}

export interface DensityCell {
  lat: number
  lon: number
  /** 0..1 — relative agent pressure in the cell. */
  weight: number
  /** Calibrated agents assigned to this cell (absolute). */
  agents: number
}

/** City-wide density field: the calibrated agents of every line are spread
 *  along the line geometry into ~1 km cells. Deterministic, cheap (no
 *  per-agent loop), and the honest city-scale read-out: a field, not a
 *  pretend full-agent render. */
export function agentDensity(snapshot: MatsimSnapshot, cellDeg = DENSITY_CELL_DEG): DensityCell[] {
  const cells = new Map<string, { lat: number, lon: number, agents: number }>()
  const add = (lat: number, lon: number, agents: number) => {
    const key = `${Math.round(lat / cellDeg)}:${Math.round(lon / cellDeg)}`
    const cell = cells.get(key) ?? { lat: Math.round(lat / cellDeg) * cellDeg, lon: Math.round(lon / cellDeg) * cellDeg, agents: 0 }
    cell.agents += agents
    cells.set(key, cell)
  }
  for (const state of snapshot.lines) {
    const line = SEED_LINES.find((l) => l.id === state.lineId)
    if (!line || state.activeAgents <= 0) continue
    const segments = lineSegments(state.lineId)
    const total = segments.reduce((sum, segment) => sum + segment.length, 0)
    if (total === 0) continue
    for (const segment of segments) {
      const share = (segment.length / total) * state.activeAgents
      for (const t of [0.25, 0.5, 0.75]) {
        add(
          segment.a[0] + (segment.b[0] - segment.a[0]) * t,
          segment.a[1] + (segment.b[1] - segment.a[1]) * t,
          share / 3,
        )
      }
    }
  }
  const list = [...cells.values()].map((cell) => ({ ...cell, agents: Math.round(cell.agents) }))
  const max = Math.max(1, ...list.map((cell) => cell.agents))
  return list
    .map((cell) => ({ lat: cell.lat, lon: cell.lon, agents: cell.agents, weight: Number((cell.agents / max).toFixed(3)) }))
    .sort((a, b) => b.weight - a.weight)
}
