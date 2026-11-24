/** CITY-LIFE-TELLING · replay pusher — a compressed MATSim-style day.
 *
 *  Workshop mode: pushes a 24-hour simulated day (compressed) to the bridge
 *  so the app, AVA and the decision model run LIVE without touching the
 *  MATSim model yet. Replace this script with the Polytechnique's own
 *  emitter (ControlerListener → POST, see matsim-bridge/README.md) when the
 *  real feed exists — the bridge and the app never change.
 *
 *      node matsim-bridge/server.mjs            # terminal 1
 *      node matsim-bridge/push-simulator.mjs    # terminal 2 — live replay
 *      node matsim-bridge/push-simulator.mjs http://localhost:8787 20 500
 *          # [url] [compression: 20× ⇒ a day in ~72 s] [push every 500 ms]
 *
 *  The line set mirrors the app's coarse Montréal seed so the map fills. */

const BASE_URL = process.argv[2] ?? 'http://localhost:8787'
const COMPRESSION = Number(process.argv[3] ?? 20)
const PUSH_MS = Number(process.argv[4] ?? 500)
const TOKEN = process.env.BRIDGE_TOKEN ?? null

const LINES = [
  { lineId: 'metro-green', base: 4, cap: 780 },
  { lineId: 'metro-orange', base: 4, cap: 780 },
  { lineId: 'metro-blue', base: 7, cap: 420 },
  { lineId: 'metro-yellow', base: 6, cap: 420 },
  { lineId: 'rem-south', base: 8, cap: 560 },
  { lineId: 'exo-vh', base: 30, cap: 1200 },
  { lineId: 'bus-80', base: 10, cap: 90 },
  { lineId: 'bus-139', base: 12, cap: 90 },
  { lineId: 'bus-121', base: 14, cap: 90 },
]

const SCENARIO = `matsim-replay-day-${new Date().toISOString().slice(0, 10)}`

function rush(hour) {
  const morning = Math.exp(-((hour - 8.2) ** 2) / 2.2)
  const evening = Math.exp(-((hour - 17.4) ** 2) / 2.6)
  return Math.min(1, 0.2 + 0.45 * morning + 0.5 * evening)
}

function weatherAt(hour) {
  const temp = 2 + 6 * Math.sin(((hour - 14) / 24) * 2 * Math.PI)
  const precip = (hour > 6 && hour < 9) || (hour > 15 && hour < 18) ? 4 + 6 * Math.abs(Math.sin(hour)) : 0
  return {
    contract: 'clt.weather.v0',
    place: 'Montréal',
    issuedAt: new Date().toISOString(),
    periods: [{ id: 'now', hours: 6, tempC: Math.round(temp * 10) / 10, precipMm: Math.round(precip * 10) / 10, precipKind: precip > 6 ? 'snow' : precip > 0 ? 'rain' : 'none', windKmh: 12 + Math.round(20 * Math.abs(Math.sin(hour))), alert: precip > 6 ? 'snow' : 'none' }],
  }
}

let simMinutes = 6 * 60 // start at 06:00
const headers = { 'Content-Type': 'application/json' }
if (TOKEN) headers['x-bridge-token'] = TOKEN

async function push(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) console.error(`push ${path} → ${res.status}: ${await res.text()}`)
  return res.ok
}

async function tick() {
  simMinutes += (PUSH_MS / 1000) * COMPRESSION * 60 / 60 // sim-minutes advanced
  if (simMinutes >= 30 * 60) simMinutes = 5 * 60 // wrap overnight → 05:00 next day
  const hour = simMinutes / 60
  const r = rush(hour)
  const lines = LINES.map(({ lineId, base, cap }) => {
    const wobble = Math.sin(simMinutes / 37 + lineId.length)
    const incident = Math.abs(Math.sin(simMinutes / 211 + lineId.length * 1.7)) > 0.985
    const delay = Math.max(0, Math.round(90 * r * (0.5 + wobble) + (incident ? 420 : 0)))
    return {
      lineId,
      status: incident ? 'disrupted' : delay >= 180 ? 'delayed' : delay >= 60 ? 'irregular' : 'nominal',
      avgDelaySec: delay,
      headwayMin: Math.round(base * (1 + 0.3 * r + (incident ? 1.2 : 0)) * 10) / 10,
      load: Math.min(0.98, Math.round((0.1 + 0.8 * r + (incident ? 0.1 : 0) + 0.05 * wobble) * 100) / 100),
      activeAgents: Math.round((cap / 90) * (500 + 2600 * r)),
      incidents: incident ? [{ id: `inc-${lineId}`, kind: 'signal', at: [45.5152, -73.5613], severity: 0.8, note: `${lineId} · signal fault (replay)` }] : [],
    }
  })
  const clock = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`
  const ok = await push('/push/snapshot', {
    scenario: SCENARIO,
    tick: Math.floor(simMinutes),
    generatedAt: new Date().toISOString(),
    lines,
    agents: { onboard: lines.reduce((n, l) => n + l.activeAgents, 0), waiting: Math.round(900 * r), avgTripMin: 24 },
    meta: { replay: true, simClock: clock, compression: COMPRESSION },
  })
  if (Math.floor(simMinutes) % 30 === 0) await push('/push/weather', weatherAt(hour))
  if (ok) console.log(`replay ${clock} · ${lines.length} lines · rush ${(r * 100).toFixed(0)}%`)
}

console.log(`→ pushing a compressed MATSim day to ${BASE_URL} (${COMPRESSION}×, every ${PUSH_MS} ms)`)
setInterval(() => { void tick() }, PUSH_MS)
