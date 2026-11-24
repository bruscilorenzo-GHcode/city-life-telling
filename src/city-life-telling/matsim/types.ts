/** CITY-LIFE-TELLING — MATSim integration contracts.
 *
 *  The platform reads the real-time state of Montréal's public-transport
 *  networks from a MATSim multi-agent simulation (Polytechnique Montréal).
 *  The production coupling mode (live events feed, pre-computed output
 *  snapshots, scenario streaming) is deliberately TO BE DEFINED with the
 *  Polytechnique team: everything downstream depends only on this file.
 *
 *  Contract `clt.matsim.snapshot.v0` is a draft agreed on our side; the
 *  `meta` bag keeps room for whatever extra payload the final feed carries.
 *  Two MatsimSource adapters exist today:
 *    - simulated  — deterministic on-device synthetic feed (default demo);
 *    - http       — polls a JSON endpoint expected to speak the contract. */

export const SNAPSHOT_CONTRACT = 'clt.matsim.snapshot.v0'

export type TransitMode = 'metro' | 'bus' | 'tram' | 'regional_rail' | 'light_rail'

export type ServiceStatus = 'nominal' | 'irregular' | 'delayed' | 'disrupted' | 'suspended'

export type Operator = 'STM' | 'REM' | 'exo' | 'STL'

export type IncidentKind =
  | 'mechanical' | 'signal' | 'crowding' | 'weather' | 'service' | 'collision'

/** Ordered coarse anchor of a line (demo seed). The authoritative transit
 *  schedule and geometry come from the Polytechnique Montréal feed. */
export interface TransitStop {
  id: string
  name: string
  lat: number
  lon: number
}

export interface TransitLine {
  id: string
  label: string
  mode: TransitMode
  operator: Operator
  /** CSS colour used on the map and the UI. */
  color: string
  stops: TransitStop[]
  /** Scheduled headway in minutes (off-peak reference). */
  baseHeadwayMin: number
  /** Nominal vehicle capacity, for the 0..1 load index. */
  capacity: number
}

export interface LineState {
  lineId: string
  status: ServiceStatus
  /** Mean signed delay of simulated vehicles on the line, in seconds. */
  avgDelaySec: number
  /** Realised headway in minutes. */
  headwayMin: number
  /** Occupancy index 0..1 (simulated agents / capacity). */
  load: number
  /** MATSim agents currently en route on the line. */
  activeAgents: number
  incidents: Incident[]
}

export interface Incident {
  id: string
  lineId: string
  kind: IncidentKind
  at: [number, number]
  startedAt: string
  severity: number
  note: string
}

export interface MatsimSnapshot {
  contract: typeof SNAPSHOT_CONTRACT
  scenario: string
  generatedAt: string
  tick: number
  lines: LineState[]
  agents: { onboard: number, waiting: number, avgTripMin: number }
  meta?: Record<string, string | number>
}

export type SnapshotListener = (snapshot: MatsimSnapshot) => void

/** Pluggable realtime source. `start` may emit immediately; `stop` must be
 *  idempotent. Implementations must never throw from the listener. */
export interface MatsimSource {
  readonly kind: 'simulated' | 'http'
  start(onSnapshot: SnapshotListener, onError?: (error: Error) => void): void
  stop(): void
  latest(): MatsimSnapshot | null
}

export const STATUS_SEVERITY: Record<ServiceStatus, number> = {
  nominal: 0, irregular: 0.25, delayed: 0.5, disrupted: 0.8, suspended: 1,
}

export function statusForDelay(delaySec: number, headwayRatio: number): ServiceStatus {
  if (delaySec >= 420 || headwayRatio >= 3) return 'disrupted'
  if (delaySec >= 180 || headwayRatio >= 2) return 'delayed'
  if (delaySec >= 60 || headwayRatio >= 1.4) return 'irregular'
  return 'nominal'
}
