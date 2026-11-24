/** CITY-LIFE-TELLING · MATSim live bridge — zero-dependency Node service.
 *
 *  The living-lab seam between a MATSim simulation (Polytechnique Montréal)
 *  and the City-Life-Telling app. MATSim experts push snapshots from their
 *  harness (full `clt.matsim.snapshot.v0` payloads OR partial per-line
 *  states, which the bridge merges); the app consumes them live via SSE or
 *  polls the JSON endpoints. Runs anywhere Node ≥ 18 runs — next to the
 *  MATSim process, in a container, or behind a TLS tunnel for the hosted
 *  app (see matsim-bridge/README.md).
 *
 *      node matsim-bridge/server.mjs              # http://localhost:8787
 *      BRIDGE_TOKEN=secret node server.mjs        # require x-bridge-token on POST
 *
 *  API
 *    POST /push/snapshot   full snapshot {contract:"clt.matsim.snapshot.v0",...}
 *                          or partial {scenario?, tick?, lines:[LineState-partial]}
 *    POST /push/weather    full forecast {contract:"clt.weather.v0",...}
 *    GET  /snapshot.json   latest composed snapshot (CORS: *)
 *    GET  /weather.json    latest forecast
 *    GET  /stream          text/event-stream — events `snapshot` and `weather`
 *    GET  /health          {ok, clients, updatedAt}
 *
 *  This bridge never invents transport data: it only validates, merges and
 *  forwards what the MATSim side sends. */

import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const PORT = Number(process.env.PORT ?? 8787)
const TOKEN = process.env.BRIDGE_TOKEN ?? null
/** Optional durable session log (JSONL): BRIDGE_RECORD=session.jsonl
 *  Every accepted push is appended, so a research session can be replayed
 *  and audited. The app also exports its own snapshot of the session. */
const RECORD_PATH = process.env.BRIDGE_RECORD ?? null
const CONTRACT = 'clt.matsim.snapshot.v0'
const WEATHER_CONTRACT = 'clt.weather.v0'
const STATUSES = new Set(['nominal', 'irregular', 'delayed', 'disrupted', 'suspended'])
const KINDS = new Set(['mechanical', 'signal', 'crowding', 'weather', 'service', 'collision'])
const HISTORY_MAX = 240

function inRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

/** Validates one LineState (full or partial). Returns the cleaned state or a reason. */
export function parseLineState(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'line must be an object' }
  if (typeof raw.lineId !== 'string' || raw.lineId.length === 0) return { ok: false, reason: 'lineId required' }
  if (raw.status !== undefined && !STATUSES.has(raw.status)) return { ok: false, reason: `line ${raw.lineId}: unknown status ${JSON.stringify(raw.status)}` }
  const clean = { lineId: raw.lineId }
  for (const [key, min, max] of [['avgDelaySec', -600, 7200], ['headwayMin', 0, 240], ['load', 0, 1], ['activeAgents', 0, 1e7]]) {
    if (raw[key] === undefined) continue
    const value = inRange(raw[key], min, max)
    if (value === null) return { ok: false, reason: `line ${raw.lineId}: ${key} out of range` }
    clean[key] = value
  }
  if (Array.isArray(raw.incidents)) {
    const incidents = []
    for (const inc of raw.incidents) {
      if (!inc || typeof inc !== 'object') return { ok: false, reason: 'incident must be an object' }
      if (typeof inc.id !== 'string' || inc.id.length === 0) return { ok: false, reason: 'incident id required' }
      if (!KINDS.has(inc.kind)) return { ok: false, reason: `incident ${inc.id}: unknown kind` }
      const at = Array.isArray(inc.at) && inc.at.length === 2 && inRange(inc.at[0], -90, 90) !== null && inRange(inc.at[1], -180, 180) !== null
      if (!at) return { ok: false, reason: `incident ${inc.id}: invalid coordinates` }
      const severity = inRange(inc.severity, 0, 1)
      if (severity === null) return { ok: false, reason: `incident ${inc.id}: severity must be 0..1` }
      incidents.push({ id: inc.id, kind: inc.kind, at: [inc.at[0], inc.at[1]], severity, note: typeof inc.note === 'string' ? inc.note.slice(0, 240) : '', startedAt: typeof inc.startedAt === 'string' ? inc.startedAt : new Date().toISOString() })
    }
    clean.incidents = incidents
  }
  return { ok: true, line: clean }
}

/** Validates a full `clt.matsim.snapshot.v0` payload. */
export function parseFullSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload is not an object' }
  if (raw.contract !== CONTRACT) return { ok: false, reason: `contract must be ${CONTRACT}` }
  if (typeof raw.scenario !== 'string' || raw.scenario.length === 0) return { ok: false, reason: 'scenario required' }
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt))) return { ok: false, reason: 'generatedAt must be an ISO date' }
  if (typeof raw.tick !== 'number' || raw.tick < 0) return { ok: false, reason: 'tick must be a non-negative number' }
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return { ok: false, reason: 'lines[] required' }
  const lines = []
  for (const entry of raw.lines) {
    const parsed = parseLineState(entry)
    if (!parsed.ok) return parsed
    const l = entry
    for (const key of ['avgDelaySec', 'headwayMin', 'load', 'activeAgents', 'status']) {
      if (l[key] === undefined) return { ok: false, reason: `line ${l.lineId}: ${key} required in a full snapshot` }
    }
    if (!STATUSES.has(l.status)) return { ok: false, reason: `line ${l.lineId}: unknown status` }
    lines.push({ ...parsed.line, status: l.status })
  }
  const agents = raw.agents ?? {}
  return {
    ok: true,
    snapshot: {
      contract: CONTRACT,
      scenario: raw.scenario,
      generatedAt: raw.generatedAt,
      tick: raw.tick,
      lines,
      agents: { onboard: agents.onboard ?? 0, waiting: agents.waiting ?? 0, avgTripMin: agents.avgTripMin ?? 0 },
      meta: raw.meta,
    },
  }
}

/** Validates a full `clt.weather.v0` payload. */
export function parseFullWeather(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload is not an object' }
  if (raw.contract !== WEATHER_CONTRACT) return { ok: false, reason: `contract must be ${WEATHER_CONTRACT}` }
  if (typeof raw.issuedAt !== 'string' || Number.isNaN(Date.parse(raw.issuedAt))) return { ok: false, reason: 'issuedAt must be an ISO date' }
  if (!Array.isArray(raw.periods) || raw.periods.length === 0) return { ok: false, reason: 'periods[] required' }
  const periods = []
  for (const p of raw.periods) {
    if (!p || typeof p !== 'object') return { ok: false, reason: 'period must be an object' }
    if (!['now', 'next', 'later'].includes(p.id)) return { ok: false, reason: `period id ${JSON.stringify(p.id)} must be now|next|later` }
    for (const [key, min, max] of [['tempC', -60, 55], ['precipMm', 0, 200], ['windKmh', 0, 250], ['hours', 1, 24]]) {
      if (inRange(p[key], min, max) === null) return { ok: false, reason: `period ${p.id}: ${key} out of range` }
    }
    periods.push({ ...p })
  }
  return { ok: true, weather: { contract: WEATHER_CONTRACT, place: typeof raw.place === 'string' ? raw.place : 'Montréal', issuedAt: raw.issuedAt, periods } }
}

/** Creates the bridge. Exported for tests; auto-listens when run directly. */
export function startBridge({ port = PORT, token = TOKEN } = {}) {
  const state = { snapshot: null, weather: null, tick: 0, updatedAt: null }
  const history = []
  const weatherHistory = []
  const sseClients = new Set()

  const record = (kind, payload) => {
    if (!RECORD_PATH) return
    try {
      appendFileSync(RECORD_PATH, JSON.stringify({ at: new Date().toISOString(), kind, payload }) + '\n')
    } catch (error) {
      console.error('[bridge] record failed:', error instanceof Error ? error.message : error)
    }
  }

  const broadcast = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of sseClients) {
      try { res.write(payload) } catch { sseClients.delete(res) }
    }
  }

  const authorized = (req, res) => {
    if (!token) return true
    if (req.headers['x-bridge-token'] === token) return true
    res.writeHead(401, corsHeaders())
    res.end(JSON.stringify({ error: 'bridge token required (x-bridge-token)' }))
    return false
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://bridge')
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...corsHeaders() })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders())
      res.end()
      return
    }

    if (req.method === 'POST' && (url.pathname === '/push/snapshot' || url.pathname === '/push/weather')) {
      if (!authorized(req, res)) return
      let raw = ''
      req.on('data', (chunk) => { raw += chunk; if (raw.length > 2e6) req.destroy() })
      req.on('end', () => {
        let payload
        try { payload = JSON.parse(raw) } catch { send(400, { error: 'invalid JSON' }); return }
        if (url.pathname === '/push/weather') {
          const parsed = parseFullWeather(payload)
          if (!parsed.ok) { send(400, { error: parsed.reason }); return }
          state.weather = parsed.weather
          weatherHistory.push(parsed.weather)
          if (weatherHistory.length > 96) weatherHistory.shift()
          record('weather', parsed.weather)
          broadcast('weather', parsed.weather)
          send(200, { ok: true, kind: 'weather' })
          return
        }
        if (payload.contract === CONTRACT) {
          const parsed = parseFullSnapshot(payload)
          if (!parsed.ok) { send(400, { error: parsed.reason }); return }
          state.snapshot = parsed.snapshot
          state.updatedAt = new Date().toISOString()
          history.push(parsed.snapshot)
          if (history.length > HISTORY_MAX) history.shift()
          record('snapshot', parsed.snapshot)
          broadcast('snapshot', parsed.snapshot)
          send(200, { ok: true, kind: 'full', lines: parsed.snapshot.lines.length, clients: sseClients.size })
          return
        }
        // Partial push: upsert line states into the composed snapshot.
        const partials = Array.isArray(payload.lines) ? payload.lines : [payload]
        const merged = new Map((state.snapshot?.lines ?? []).map((l) => [l.lineId, l]))
        let tick = typeof payload.tick === 'number' && payload.tick >= 0 ? payload.tick : (state.snapshot?.tick ?? 0) + 1
        for (const entry of partials) {
          const parsed = parseLineState(entry)
          if (!parsed.ok) { send(400, { error: parsed.reason }); return }
          merged.set(parsed.line.lineId, { ...merged.get(parsed.line.lineId), ...parsed.line })
        }
        const lines = [...merged.values()]
        const onboard = lines.reduce((n, l) => n + (l.activeAgents ?? 0), 0)
        state.snapshot = {
          contract: CONTRACT,
          scenario: typeof payload.scenario === 'string' ? payload.scenario : state.snapshot?.scenario ?? 'matsim-live',
          generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString(),
          tick,
          lines,
          agents: { ...(state.snapshot?.agents ?? { onboard, waiting: 0, avgTripMin: 0 }), ...(payload.agents ?? {}) },
          meta: { ...(state.snapshot?.meta ?? {}), push: 'partial' },
        }
        state.updatedAt = state.snapshot.generatedAt
        history.push(state.snapshot)
        if (history.length > HISTORY_MAX) history.shift()
        record('snapshot', state.snapshot)
        broadcast('snapshot', state.snapshot)
        send(200, { ok: true, kind: 'partial', lines: lines.length, clients: sseClients.size })
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/snapshot.json') {
      if (state.snapshot) send(200, state.snapshot)
      else send(503, { error: 'no snapshot pushed yet' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/weather.json') {
      if (state.weather) send(200, state.weather)
      else send(503, { error: 'no weather pushed yet' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        ...corsHeaders(),
      })
      if (state.snapshot) res.write(`event: snapshot\ndata: ${JSON.stringify(state.snapshot)}\n\n`)
      if (state.weather) res.write(`event: weather\ndata: ${JSON.stringify(state.weather)}\n\n`)
      sseClients.add(res)
      const heartbeat = setInterval(() => { try { res.write(':ka\n\n') } catch { /* closed */ } }, 15000)
      req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res) })
      return
    }
    if (req.method === 'GET' && url.pathname === '/export') {
      send(200, {
        document: 'city-life-telling.bridge-export.v1',
        exportedAt: new Date().toISOString(),
        snapshots: history,
        weather: weatherHistory,
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      send(200, { ok: true, clients: sseClients.size, updatedAt: state.updatedAt, hasWeather: !!state.weather })
      return
    }
    send(404, { error: 'unknown route' })
  })

  return {
    server,
    state,
    history,
    sseClients,
    listen(callback) {
      server.listen(port, () => callback?.(server.address()))
      return server
    },
    close() { server.close() },
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-bridge-token',
  }
}

if (process.argv[1] && (process.argv[1].endsWith('server.mjs') || process.argv[1].endsWith('server.js'))) {
  const bridge = startBridge()
  bridge.listen((address) => {
    console.log(`[city-life-telling bridge] listening on http://localhost:${address.port}`)
    console.log(`  POST /push/snapshot · POST /push/weather · GET /stream · GET /snapshot.json · GET /health`)
    console.log(`  auth: ${TOKEN ? 'BRIDGE_TOKEN required on POST' : 'open (set BRIDGE_TOKEN to lock)'}`)
  })
}
