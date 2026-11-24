import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBridge } from '../matsim-bridge/server.mjs'
import { publishCityStory } from '../src/city-life-telling/store'
import { promptRefOf, simulationPrompts } from '../src/city-life-telling/prompts'
import { avaRead } from '../src/city-life-telling/ava-agent'
import { decideStrategies } from '../src/city-life-telling/strategy'
import { simulateWeather } from '../src/city-life-telling/weather'
import type { MatsimSnapshot } from '../src/city-life-telling/matsim/types'

/** End-to-end: the loop MATSim → prompt → story → AVA → strategies.
 *  This is the integration the researchers test with the Polytechnique team. */

let base = ''
let stop = () => {}

beforeAll(async () => {
  const bridge = startBridge({ port: 0 })
  await new Promise<void>((resolve) => bridge.listen((address) => {
    base = `http://127.0.0.1:${address.port}`
    resolve()
  }))
  stop = bridge.close
})

afterAll(() => stop())

const SNAPSHOT = {
  contract: 'clt.matsim.snapshot.v0',
  scenario: 'mtl-session-research',
  generatedAt: new Date().toISOString(),
  tick: 42,
  lines: [
    { lineId: 'metro-green', status: 'delayed', avgDelaySec: 400, headwayMin: 7, load: 0.85, activeAgents: 4200, incidents: [] },
    { lineId: 'metro-orange', status: 'nominal', avgDelaySec: 25, headwayMin: 4, load: 0.3, activeAgents: 1800, incidents: [] },
    { lineId: 'bus-80', status: 'delayed', avgDelaySec: 420, headwayMin: 18, load: 0.9, activeAgents: 260, incidents: [
      { id: 'inc-80', kind: 'mechanical', at: [45.5236, -73.6018], severity: 0.7, note: 'breakdown on Du Parc' },
    ] },
  ],
  agents: { onboard: 6260, waiting: 1900, avgTripMin: 26 },
}

async function push(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) })
  expect(res.status).toBe(200)
}

async function latest(): Promise<MatsimSnapshot> {
  const res = await fetch(`${base}/snapshot.json`)
  expect(res.status).toBe(200)
  return await res.json() as MatsimSnapshot
}

describe('MATSim ⇄ story collection integration', () => {
  it('turns the live anomalies into prompts, then validates the answering story against the same snapshot', async () => {
    await push('/push/snapshot', SNAPSHOT)
    const snapshot = await latest()

    // 1 · the simulation proposes the most anomalous lines as neutral prompts
    const prompts = simulationPrompts(snapshot, 3)
    expect(prompts.length).toBeGreaterThanOrEqual(2)
    expect(prompts[0]!.lineId).toBe('bus-80')
    expect(prompts.map((p) => p.lineId)).toContain('metro-green')
    expect(prompts[0]!.score).toBeGreaterThan(prompts[1]!.score)

    // 2 · a citizen answers one prompt with a functional claim
    const greenPrompt = prompts.find((p) => p.lineId === 'metro-green')!
    const story = await publishCityStory(
      {
        narrative: 'La fermata era piena, la gente aspettava sotto la pioggia senza pensilina, come in un pronto soccorso.',
        functional: '8h15, ligne verte direction Angrignon: 12 minutes de retard à Sherbrooke, quai bondé.',
        lang: 'fr', lat: 45.5183, lon: -73.5686,
        prompt_ref: promptRefOf(greenPrompt),
      },
      { geo_mode: 'grid', allow_dispatch: true },
      snapshot,
    )

    // 3 · the verdict is against the exact snapshot the story was born in
    expect(story.snapshot_ref).toEqual({
      contract: 'clt.matsim.snapshot.v0',
      scenario: 'mtl-session-research',
      tick: 42,
      generatedAt: SNAPSHOT.generatedAt,
    })
    expect(story.prompt_ref).toEqual({ source: 'simulation', lineId: 'metro-green', tick: 42, simStatus: 'delayed' })
    expect(story.ava.verdict).toBe('confirms')
    expect(story.signal.facts).toBeGreaterThan(0)

    // 4 · the decision model ranks strategies from the same live state
    const forecast = simulateWeather(3, new Date('2026-11-06T13:20:00Z'))
    forecast.periods = forecast.periods.map((p) => ({ ...p, precipKind: 'rain' as const, precipMm: 14, alert: 'storm' as const }))
    const strategies = decideStrategies(snapshot, forecast, { storyCount: 1, divergingCount: 0 })
    expect(strategies.some((s) => s.id === 'congestion-relief')).toBe(true)
    expect(strategies.some((s) => s.id === 'storm-advisory')).toBe(true)
    const targets = strategies.flatMap((s) => s.targetLines)
    expect(targets).toContain('bus-80')
  })

  it('re-checks the same story against a partial live update (real-time corroboration)', async () => {
    await push('/push/snapshot', { lines: [{ lineId: 'metro-green', status: 'nominal', avgDelaySec: 20, load: 0.3 }] })
    const snapshot = await latest()
    expect(snapshot.lines.find((l) => l.lineId === 'metro-green')?.avgDelaySec).toBe(20)
    // other lines untouched by the partial push
    expect(snapshot.lines.find((l) => l.lineId === 'bus-80')?.load).toBe(0.9)

    const reading = avaRead(
      { narrative: 'Scène du quai.', functional: 'ligne verte: 12 minutes de retard, quai bondé.' },
      snapshot,
      null,
    )
    expect(reading.correlations[0]!.verdict).toBe('diverges')
  })

  it('exports the recorded session for analysis and replay', async () => {
    const exported = await (await fetch(`${base}/export`)).json()
    expect(exported.document).toBe('city-life-telling.bridge-export.v1')
    expect(exported.snapshots.length).toBeGreaterThanOrEqual(2)
    expect(exported.snapshots.at(-1).lines.length).toBe(3)
  })
})
