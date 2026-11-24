/** CITY-LIFE-TELLING · bridge verification script (for the MATSim team).
 *
 *  Run this against a LIVE bridge before a research session: it checks that
 *  the bridge is up and that what it serves respects `clt.matsim.snapshot.v0`
 *  (and `clt.weather.v0` when pushed). Exit code 0 = go, 1 = stop.
 *
 *      node matsim-bridge/verify.mjs                        # localhost:8787
 *      node matsim-bridge/verify.mjs https://bridge.example # remote (TLS)
 */

const BASE = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '')
const CONTRACT = 'clt.matsim.snapshot.v0'
const WEATHER_CONTRACT = 'clt.weather.v0'
const STATUSES = new Set(['nominal', 'irregular', 'delayed', 'disrupted', 'suspended'])

let failures = 0
const pass = (msg) => console.log(`  ✔ ${msg}`)
const fail = (msg) => { failures += 1; console.log(`  ✘ ${msg}`) }
const warn = (msg) => console.log(`  · ${msg}`)

async function json(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

console.log(`\nCity-Life-Telling · bridge verification @ ${BASE}`)

try {
  const health = await json('/health')
  health.ok ? pass(`health ok (${health.clients ?? 0} live clients)`) : fail('health does not report ok')
  if (!health.updatedAt) warn('no snapshot received yet — start the MATSim pusher first')
} catch (error) {
  fail(`bridge unreachable: ${error.message}`)
  process.exit(1)
}

try {
  const snap = await json('/snapshot.json')
  snap.contract === CONTRACT ? pass(`contract ${snap.contract}`) : fail(`wrong contract: ${snap.contract}`)
  typeof snap.tick === 'number' ? pass(`tick ${snap.tick} · scenario ${snap.scenario}`) : fail('tick missing')
  if (!Array.isArray(snap.lines) || snap.lines.length === 0) fail('no lines in the snapshot')
  else {
    pass(`${snap.lines.length} lines`)
    let bad = 0
    for (const line of snap.lines) {
      const rowOk = typeof line.lineId === 'string'
        && STATUSES.has(line.status)
        && typeof line.avgDelaySec === 'number'
        && typeof line.load === 'number' && line.load >= 0 && line.load <= 1
        && typeof line.activeAgents === 'number'
      if (!rowOk) { bad += 1; console.log(`     ✘ ${JSON.stringify(line.lineId ?? line)}`) }
    }
    bad === 0 ? pass('every line state is contract-valid') : fail(`${bad} invalid line states`)
    const worst = [...snap.lines].sort((a, b) => b.load * b.avgDelaySec - a.load * a.avgDelaySec)[0]
    warn(`busiest: ${worst.lineId} · load ${Math.round(worst.load * 100)}% · delay ${worst.avgDelaySec}s`)
  }
  const age = Date.now() - Date.parse(snap.generatedAt)
  Number.isFinite(age) ? (age < 10 * 60 * 1000
    ? pass(`fresh snapshot (${Math.round(age / 1000)}s old)`)
    : warn(`snapshot is ${Math.round(age / 60000)} min old — is the pusher still running?`))
    : fail('generatedAt is not a valid date')
} catch (error) {
  fail(`snapshot.json: ${error.message}`)
}

try {
  const weather = await json('/weather.json')
  weather.contract === WEATHER_CONTRACT
    ? pass(`weather contract ${weather.contract} · ${weather.periods?.length ?? 0} periods`)
    : fail(`wrong weather contract: ${weather.contract}`)
} catch (error) {
  warn(`weather not pushed yet (${error.message}) — the app will simulate weather`)
}

try {
  const exported = await json('/export')
  exported.document === 'city-life-telling.bridge-export.v1'
    ? pass(`export ok · ${exported.snapshots?.length ?? 0} snapshots in history`)
    : fail('export document missing')
} catch (error) {
  fail(`export: ${error.message}`)
}

if (failures > 0) {
  console.log(`\nRESULT: STOP — ${failures} check(s) failed. Fix the feed before the session.\n`)
  process.exit(1)
}
console.log('\nRESULT: GO — the bridge is ready for a research session.\n')
