/** CITY-LIFE-TELLING — deterministic on-device MATSim source.
 *
 *  A synthetic, seeded, real-time evolution of the Montréal network used
 *  while the Polytechnique Montréal feed is not wired in. Every snapshot is
 *  a pure function of (seed, tick, wall time): same inputs, same state, so
 *  tests and demo sessions are reproducible and the engine is stateless.
 *  Nothing here pretends to be MATSim output — the UI labels it SYNTHETIC. */

// .ts specifiers: also executed by the ava_record CLI under
// `node --experimental-strip-types`, which does not rewrite .js → .ts.
import { SEED_LINES } from './network.ts'
import {
  SNAPSHOT_CONTRACT,
  statusForDelay,
  type Incident,
  type IncidentKind,
  type LineState,
  type MatsimSnapshot,
  type MatsimSource,
  type ServiceStatus,
  type SnapshotListener,
} from './types.ts'

export interface SimulatedSourceOptions {
  /** Any 32-bit integer. Same seed ⇒ same network evolution. */
  seed: number
  /** Snapshot cadence in ms (default 6000). */
  tickMs?: number
  scenario?: string
  /** Injectable wall clock (tests). */
  now?: () => Date
}

/** Integer avalanche hash → [0,1). Deterministic across platforms. */
export function hash01(...parts: number[]): number {
  let h = 0x811c9dc5
  for (const part of parts) {
    h ^= part | 0
    h = Math.imul(h, 0x01000193)
    h ^= h >>> 13
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Montréal service-day rhythm, 0 (night lull) .. 1 (rush peak). */
export function timeOfDayFactor(when: Date): number {
  const hour = (when.getUTCHours() - 5 + 24) % 24
  const minute = when.getUTCMinutes() / 60
  const t = hour + minute
  const morning = Math.exp(-((t - 8.2) ** 2) / 2.2)
  const evening = Math.exp(-((t - 17.4) ** 2) / 2.6)
  const base = 0.22 + 0.5 * (1 + Math.sin(((t - 6) / 24) * Math.PI)) / 2
  return Math.min(1, base + 0.45 * morning + 0.5 * evening)
}

const KINDS: IncidentKind[] = ['mechanical', 'signal', 'crowding', 'weather', 'service', 'collision']
const WINDOW_TICKS = 12

function lineIncident(seed: number, lineIndex: number, tick: number, rush: number): Incident | null {
  const window = Math.floor(tick / WINDOW_TICKS)
  const spawn = 0.06 + 0.16 * rush
  for (let w = window; w >= window - 2; w -= 1) {
    if (hash01(seed, lineIndex, w, 101) >= spawn) continue
    const start = w * WINDOW_TICKS + Math.floor(hash01(seed, lineIndex, w, 202) * (WINDOW_TICKS - 4))
    const duration = 2 + Math.floor(hash01(seed, lineIndex, w, 303) * 9)
    if (tick < start || tick > start + duration) continue
    const kind = KINDS[Math.floor(hash01(seed, lineIndex, w, 404) * KINDS.length)] ?? 'service'
    const severity = 0.2 + 0.7 * hash01(seed, lineIndex, w, 505)
    const line = SEED_LINES[lineIndex]!
    const stop = line.stops[Math.floor(hash01(seed, lineIndex, w, 606) * line.stops.length)] ?? line.stops[0]!
    return {
      id: `inc_${line.id}_${w}`,
      lineId: line.id,
      kind,
      at: [stop.lat, stop.lon],
      startedAt: new Date(start * 6000 * 1000).toISOString(),
      severity: Number(severity.toFixed(2)),
      note: `${kind} · ${line.label}`,
    }
  }
  return null
}

/** Pure snapshot generator — the heart of the synthetic feed. */
export function simulateSnapshot(seed: number, tick: number, when: Date, scenario: string): MatsimSnapshot {
  const rush = timeOfDayFactor(when)
  const lines: LineState[] = SEED_LINES.map((line, lineIndex) => {
    const incident = lineIncident(seed, lineIndex, tick, rush)
    const severity = incident?.severity ?? 0
    const wander = hash01(seed, lineIndex, tick, 11) - 0.5
    const slow = hash01(seed, lineIndex, Math.floor(tick / 8), 12) - 0.5
    const delay = rush * 90 * (0.5 + slow) + 120 * wander * (0.4 + rush) + 520 * severity
    const avgDelaySec = Math.max(-30, Math.round(delay))
    const headwayMin = Number((line.baseHeadwayMin * (1 + 0.25 * rush + 0.9 * severity + 0.2 * slow)).toFixed(1))
    const load = Math.min(0.98, Math.max(0.05, 0.12 + 0.72 * rush + 0.18 * severity + 0.1 * wander))
    const status: ServiceStatus = statusForDelay(avgDelaySec, headwayMin / line.baseHeadwayMin)
    const activeAgents = Math.round((line.capacity / 90) * (600 + 2400 * rush) * (0.7 + 0.6 * hash01(seed, lineIndex, tick, 13)))
    return {
      lineId: line.id,
      status,
      avgDelaySec,
      headwayMin,
      load: Number(load.toFixed(2)),
      activeAgents,
      incidents: incident ? [incident] : [],
    }
  })
  const onboard = lines.reduce((n, l) => n + l.activeAgents, 0)
  return {
    contract: SNAPSHOT_CONTRACT,
    scenario,
    generatedAt: when.toISOString(),
    tick,
    lines,
    agents: {
      onboard,
      waiting: Math.round(onboard * (0.3 + 0.15 * hash01(seed, 999, tick, 14))),
      avgTripMin: Number((19 + 9 * rush + 2 * (hash01(seed, 998, tick, 15) - 0.5)).toFixed(1)),
    },
    meta: { seed, mode: 'simulated', rush: Number(rush.toFixed(2)) },
  }
}

export class SimulatedMatsimSource implements MatsimSource {
  readonly kind = 'simulated' as const
  private timer: ReturnType<typeof setInterval> | null = null
  private tick = 0
  private last: MatsimSnapshot | null = null
  private readonly seed: number
  private readonly tickMs: number
  private readonly scenario: string
  private readonly now: () => Date

  constructor(options: SimulatedSourceOptions) {
    this.seed = options.seed | 0
    this.tickMs = options.tickMs ?? 6000
    this.scenario = options.scenario ?? 'clt-synthetic-montreal-v1'
    this.now = options.now ?? (() => new Date())
  }

  start(onSnapshot: SnapshotListener, onError?: (error: Error) => void): void {
    if (this.timer) return
    const emit = () => {
      try {
        this.last = simulateSnapshot(this.seed, this.tick, this.now(), this.scenario)
        this.tick += 1
        onSnapshot(this.last)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
    emit()
    this.timer = setInterval(emit, this.tickMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  latest(): MatsimSnapshot | null {
    return this.last
  }
}
