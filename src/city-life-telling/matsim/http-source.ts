/** CITY-LIFE-TELLING — remote MATSim source (Polytechnique Montréal).
 *
 *  Polls a JSON endpoint expected to speak `clt.matsim.snapshot.v0`.
 *  The production coupling with Polytechnique Montréal (live MATSim event
 *  stream vs pre-computed snapshots vs scenario replay) is still to be
 *  defined; until then this adapter is the narrow seam the final feed has
 *  to satisfy. Parsing is defensive: a malformed snapshot never reaches the
 *  UI — the onError channel carries a typed reason instead. */

import {
  SNAPSHOT_CONTRACT,
  type Incident,
  type IncidentKind,
  type LineState,
  type MatsimSnapshot,
  type MatsimSource,
  type ServiceStatus,
  type SnapshotListener,
} from './types.js'

const STATUSES = new Set<ServiceStatus>(['nominal', 'irregular', 'delayed', 'disrupted', 'suspended'])
const KINDS = new Set<IncidentKind>(['mechanical', 'signal', 'crowding', 'weather', 'service', 'collision'])

export type SnapshotParseResult =
  | { ok: true, snapshot: MatsimSnapshot }
  | { ok: false, reason: string }

function num(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

export function parseSnapshot(raw: unknown): SnapshotParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload is not an object' }
  const data = raw as Record<string, unknown>
  if (data.contract !== SNAPSHOT_CONTRACT) {
    return { ok: false, reason: `contract must be ${SNAPSHOT_CONTRACT}, got ${JSON.stringify(data.contract)}` }
  }
  if (typeof data.scenario !== 'string' || data.scenario.length === 0) return { ok: false, reason: 'scenario required' }
  if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) {
    return { ok: false, reason: 'generatedAt must be an ISO date' }
  }
  const tick = num(data.tick, 0, Number.MAX_SAFE_INTEGER)
  if (tick === null) return { ok: false, reason: 'tick must be a non-negative number' }
  if (!Array.isArray(data.lines) || data.lines.length === 0) return { ok: false, reason: 'lines[] required' }

  const lines: LineState[] = []
  for (const entry of data.lines) {
    if (!entry || typeof entry !== 'object') return { ok: false, reason: 'line entry must be an object' }
    const l = entry as Record<string, unknown>
    if (typeof l.lineId !== 'string' || l.lineId.length === 0) return { ok: false, reason: 'lineId required' }
    if (typeof l.status !== 'string' || !STATUSES.has(l.status as ServiceStatus)) {
      return { ok: false, reason: `line ${l.lineId}: unknown status ${JSON.stringify(l.status)}` }
    }
    const avgDelaySec = num(l.avgDelaySec, -600, 7200)
    const headwayMin = num(l.headwayMin, 0, 240)
    const load = num(l.load, 0, 1)
    const activeAgents = num(l.activeAgents, 0, 1e7)
    if (avgDelaySec === null || headwayMin === null || load === null || activeAgents === null) {
      return { ok: false, reason: `line ${l.lineId}: numeric fields out of range` }
    }
    const incidents: Incident[] = []
    if (l.incidents !== undefined) {
      if (!Array.isArray(l.incidents)) return { ok: false, reason: `line ${l.lineId}: incidents must be an array` }
      for (const rawIncident of l.incidents) {
        if (!rawIncident || typeof rawIncident !== 'object') return { ok: false, reason: 'incident must be an object' }
        const inc = rawIncident as Record<string, unknown>
        if (typeof inc.id !== 'string' || inc.id.length === 0) return { ok: false, reason: 'incident id required' }
        if (typeof inc.kind !== 'string' || !KINDS.has(inc.kind as IncidentKind)) {
          return { ok: false, reason: `incident ${inc.id}: unknown kind` }
        }
        if (!Array.isArray(inc.at) || inc.at.length !== 2
          || num(inc.at[0], -90, 90) === null || num(inc.at[1], -180, 180) === null) {
          return { ok: false, reason: `incident ${inc.id}: invalid coordinates` }
        }
        const severity = num(inc.severity, 0, 1)
        if (severity === null) return { ok: false, reason: `incident ${inc.id}: severity must be 0..1` }
        incidents.push({
          id: inc.id,
          lineId: String(l.lineId),
          kind: inc.kind as IncidentKind,
          at: [inc.at[0] as number, inc.at[1] as number],
          startedAt: typeof inc.startedAt === 'string' ? inc.startedAt : data.generatedAt as string,
          severity,
          note: typeof inc.note === 'string' ? inc.note.slice(0, 240) : '',
        })
      }
    }
    lines.push({
      lineId: String(l.lineId),
      status: l.status as ServiceStatus,
      avgDelaySec,
      headwayMin,
      load,
      activeAgents,
      incidents,
    })
  }
  const agents = (data.agents ?? {}) as Record<string, unknown>
  const onboard = num(agents.onboard, 0, 1e7) ?? 0
  const snapshot: MatsimSnapshot = {
    contract: SNAPSHOT_CONTRACT,
    scenario: data.scenario,
    generatedAt: data.generatedAt,
    tick,
    lines,
    agents: {
      onboard,
      waiting: num(agents.waiting, 0, 1e7) ?? 0,
      avgTripMin: num(agents.avgTripMin, 0, 600) ?? 0,
    },
    meta: (data.meta ?? undefined) as MatsimSnapshot['meta'],
  }
  return { ok: true, snapshot }
}

export interface HttpSourceOptions {
  url: string
  /** Poll cadence in ms (default 10000) — ignored for SSE stream URLs. */
  pollMs?: number
  /** Injectable fetch (tests). */
  fetcher?: typeof fetch
}

/** `/stream` endpoints are served as Server-Sent Events by the bridge:
 *  the app subscribes instead of polling (true live push, auto-reconnect). */
export function isStreamUrl(url: string): boolean {
  return /\/stream(\?|$)/.test(url)
}

export class HttpMatsimSource implements MatsimSource {
  readonly kind = 'http' as const
  private timer: ReturnType<typeof setInterval> | null = null
  private source: EventSource | null = null
  private last: MatsimSnapshot | null = null
  private readonly url: string
  private readonly pollMs: number
  private readonly fetcher: typeof fetch

  constructor(options: HttpSourceOptions) {
    this.url = options.url
    this.pollMs = options.pollMs ?? 10000
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args))
  }

  start(onSnapshot: SnapshotListener, onError?: (error: Error) => void): void {
    if (this.timer || this.source) return
    if (isStreamUrl(this.url) && typeof EventSource !== 'undefined') {
      const es = new EventSource(this.url)
      es.addEventListener('snapshot', (event) => {
        try {
          const parsed = parseSnapshot(JSON.parse((event as MessageEvent).data as string))
          if (!parsed.ok) throw new Error(parsed.reason)
          this.last = parsed.snapshot
          onSnapshot(parsed.snapshot)
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error(String(error)))
        }
      })
      es.onerror = () => onError?.(new Error('stream interrupted — reconnecting'))
      this.source = es
      return
    }
    const poll = async () => {
      try {
        const res = await this.fetcher(this.url, { headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const parsed = parseSnapshot(await res.json())
        if (!parsed.ok) throw new Error(parsed.reason)
        this.last = parsed.snapshot
        onSnapshot(parsed.snapshot)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
    void poll()
    this.timer = setInterval(() => void poll(), this.pollMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.source) { this.source.close(); this.source = null }
  }

  latest(): MatsimSnapshot | null {
    return this.last
  }
}
