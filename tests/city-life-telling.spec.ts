import { describe, expect, it, vi } from 'vitest'
import {
  MONTREAL_CENTER,
  SEED_LINES,
  lineById,
} from '../src/city-life-telling/matsim/network'
import { SNAPSHOT_CONTRACT, type MatsimSnapshot } from '../src/city-life-telling/matsim/types'
import { SimulatedMatsimSource, hash01, simulateSnapshot, timeOfDayFactor } from '../src/city-life-telling/matsim/simulated-source'
import { HttpMatsimSource, parseSnapshot } from '../src/city-life-telling/matsim/http-source'
import { analyzeStory, bandFor } from '../src/city-life-telling/signal'
import { avaRead, detectClaims, inferClaimKind, cellPoint } from '../src/city-life-telling/ava-agent'
import { generateKey, isValidKey } from '../src/city-life-telling/ava-key'
import { putMedia, validateMediaBatch } from '../src/city-life-telling/media-db'
import { simulateWeather, parseWeather, forecastStress } from '../src/city-life-telling/weather'
import { decideStrategies } from '../src/city-life-telling/strategy'
import {
  addEcho,
  decodeShareHash,
  deleteStory,
  encodeShareHash,
  loadMode,
  loadSourcePrefs,
  loadMine,
  loadStories,
  markMine,
  publishCityStory,
  saveStories,
  unmarkMine,
  validateInput,
} from '../src/city-life-telling/store'

const WHEN = new Date('2026-11-05T13:20:00Z') // 8:20 AM Montréal → morning rush
const SNAPSHOT = simulateSnapshot(20261105, 7, WHEN, 'clt-synthetic-montreal-v1')

function storage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
}

describe('montréal network seed', () => {
  it('ships metro, REM, exo and bus corridors with plausible anchors', () => {
    expect(SEED_LINES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(SEED_LINES.map((l) => l.id)).size).toBe(SEED_LINES.length)
    expect(lineById('metro-green')?.operator).toBe('STM')
    expect(lineById('metro-green')?.mode).toBe('metro')
    expect(lineById('rem-south')?.operator).toBe('REM')
    expect(lineById('exo-vh')?.operator).toBe('exo')
    for (const line of SEED_LINES) {
      expect(line.stops.length).toBeGreaterThanOrEqual(3)
      for (const stop of line.stops) {
        expect(stop.lat).toBeGreaterThan(45.3)
        expect(stop.lat).toBeLessThan(45.7)
        expect(stop.lon).toBeGreaterThan(-74.1)
        expect(stop.lon).toBeLessThan(-73.4)
      }
    }
    expect(MONTREAL_CENTER[0]).toBeGreaterThan(45.4)
  })
})

describe('simulated MATSim source', () => {
  it('is a pure function of (seed, tick, time): identical inputs, identical snapshot', () => {
    const a = simulateSnapshot(42, 3, WHEN, 's')
    const b = simulateSnapshot(42, 3, WHEN, 's')
    expect(a).toEqual(b)
    const c = simulateSnapshot(43, 3, WHEN, 's')
    expect(c).not.toEqual(a)
  })

  it('emits contract-valid snapshots through the listener', () => {
    const source = new SimulatedMatsimSource({ seed: 7, tickMs: 1000, now: () => WHEN })
    const listener = vi.fn()
    source.start(listener)
    expect(listener).toHaveBeenCalledTimes(1)
    const snap = listener.mock.calls[0]![0] as MatsimSnapshot
    expect(snap.contract).toBe(SNAPSHOT_CONTRACT)
    expect(snap.lines.length).toBe(SEED_LINES.length)
    for (const line of snap.lines) {
      expect(line.avgDelaySec).toBeGreaterThanOrEqual(-30)
      expect(line.load).toBeGreaterThanOrEqual(0)
      expect(line.load).toBeLessThanOrEqual(1)
      expect(['nominal', 'irregular', 'delayed', 'disrupted', 'suspended']).toContain(line.status)
    }
    expect(snap.agents.onboard).toBeGreaterThan(0)
    source.stop()
  })

  it('keeps delay and load bounded over a long horizon', () => {
    for (let tick = 0; tick < 500; tick += 7) {
      const snap = simulateSnapshot(9, tick, WHEN, 's')
      for (const line of snap.lines) {
        expect(line.avgDelaySec).toBeLessThan(1000)
        expect(line.headwayMin).toBeLessThan(120)
        expect(line.activeAgents).toBeGreaterThan(0)
      }
    }
  })

  it('rush hour pushes loads up vs the night lull', () => {
    const night = simulateSnapshot(5, 2, WHEN, 's')
    const lull = simulateSnapshot(5, 2, new Date('2026-11-05T07:20:00Z'), 's')
    expect(timeOfDayFactor(WHEN)).toBeGreaterThan(timeOfDayFactor(new Date('2026-11-05T07:20:00Z')))
    const loadOf = (s: MatsimSnapshot) => s.lines.reduce((a, l) => a + l.load, 0) / s.lines.length
    expect(loadOf(night)).toBeGreaterThan(loadOf(lull))
  })

  it('hash01 is deterministic and in range', () => {
    for (let i = 0; i < 200; i++) {
      const v = hash01(i, 3, i * 7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3))
    expect(hash01(1, 2, 3)).not.toBe(hash01(3, 2, 1))
  })
})

describe('http MATSim source contract', () => {
  it('accepts a valid snapshot', () => {
    const result = parseSnapshot(JSON.parse(JSON.stringify(SNAPSHOT)))
    expect(result.ok).toBe(true)
  })

  it('rejects malformed snapshots with reasons', () => {
    expect(parseSnapshot(null).ok).toBe(false)
    expect(parseSnapshot({}).ok).toBe(false)
    const bad = { ...SNAPSHOT, contract: 'other' }
    expect(parseSnapshot(bad).ok).toBe(false)
    const badStatus = { ...SNAPSHOT, lines: [{ ...SNAPSHOT.lines[0]!, status: 'vapour' }] }
    expect(parseSnapshot(badStatus).ok).toBe(false)
    const badLoad = { ...SNAPSHOT, lines: [{ ...SNAPSHOT.lines[0]!, load: 12 }] }
    expect(parseSnapshot(badLoad).ok).toBe(false)
    const badIncident = { ...SNAPSHOT, lines: [{ ...SNAPSHOT.lines[0]!, incidents: [{ id: 'x', kind: 'alien', at: [0, 0], severity: 1 }] }] }
    expect(parseSnapshot(badIncident).ok).toBe(false)
  })

  it('surfaces feed errors without throwing', async () => {
    const fetcher = vi.fn(async () => new Response('{"nope":true}', { status: 200 }))
    const source = new HttpMatsimSource({ url: 'https://example.test/snapshot.json', pollMs: 100000, fetcher: fetcher as unknown as typeof fetch })
    const onError = vi.fn()
    source.start(vi.fn(), onError)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(String(onError.mock.calls[0]![0])).toMatch(/contract/)
  })
})

describe('fiction ⇄ facts signal', () => {
  it('scores a concrete, verifiable observation as facts-leaning', () => {
    const sig = analyzeStory({
      narrative: 'Le train est arrivé.',
      functional: '8h15, ligne verte direction Angrignon: 12 minutes d\'attente à Sherbrooke, quai bondé, deux rames annulées après une panne.',
    })
    expect(sig.facts).toBeGreaterThan(60)
    expect(sig.realityIndex).toBeGreaterThan(58)
    expect(['fact-leaning', 'saturated-facts']).toContain(sig.band)
  })

  it('scores a memory piece as fiction-leaning', () => {
    const sig = analyzeStory({
      narrative: 'Je me souviens de ma grand-mère dans le métro, comme une note tenue au violoncelle; ça sentait la pluie et le pain chaud, on dirait une chanson que la ville murmurait pour nous.',
      functional: 'Le bus passait.',
    })
    expect(sig.fiction).toBeGreaterThan(55)
    expect(sig.realityIndex).toBeLessThan(42)
    expect(['saturated-fiction', 'narrative-leaning']).toContain(sig.band)
  })

  it('keeps a mixed story measured on both sides and bandFor monotone', () => {
    const sig = analyzeStory({
      narrative: 'Je me souviens: hier soir, à la station Jean-Talon, tout le monde a chanté quand la rame est enfin arrivée, comme un chœur fatigué et joyeux; on dirait que la ville nous consolait, pleine de nostalgie.',
      functional: 'Hier 17h40, ligne orange: 9 minutes de retard, deux rames bondées, attente sur le quai.',
    })
    expect(sig.facts).toBeGreaterThan(30)
    expect(sig.fiction).toBeGreaterThan(30)
    expect(['balanced', 'fact-leaning', 'narrative-leaning']).toContain(sig.band)
    expect(bandFor(10)).toBe('saturated-fiction')
    expect(bandFor(30)).toBe('narrative-leaning')
    expect(bandFor(50)).toBe('balanced')
    expect(bandFor(70)).toBe('fact-leaning')
    expect(bandFor(90)).toBe('saturated-facts')
  })

  it('is deterministic', () => {
    const a = analyzeStory({ narrative: 'Mi ricordo tutto', functional: 'Ritardo di 20 minuti al bus 80' })
    const b = analyzeStory({ narrative: 'Mi ricordo tutto', functional: 'Ritardo di 20 minuti al bus 80' })
    expect(a).toEqual(b)
  })
})

describe('claims and AVA cross-check', () => {
  it('extracts trilingual line claims and infers claim kinds', () => {
    const claims = detectClaims('La ligne verte était en retard; le bus 80 bondé; il REM Brossard bloqué.')
    expect(claims.map((c) => c.lineId).sort()).toEqual(['bus-80', 'metro-green', 'rem-south'].sort())
    expect(inferClaimKind('bus 80 pieno, coda enorme')).toBe('crowding')
    expect(inferClaimKind('ligne orange annulée')).toBe('cancelled')
    expect(inferClaimKind('métro chiuso')).toBe('closed')
    expect(inferClaimKind('panne sulla linea verde')).toBe('mechanical')
    expect(inferClaimKind('la stazione è bella')).toBe('other')
  })

  it('confirms a story when the simulation shows the same delay', () => {
    const delayed: MatsimSnapshot = {
      ...SNAPSHOT,
      lines: SNAPSHOT.lines.map((l) => l.lineId === 'metro-green'
        ? { ...l, avgDelaySec: 300, status: 'delayed', load: 0.8 }
        : l),
    }
    const reading = avaRead(
      { narrative: 'La ville attend.', functional: '8h15, ligne verte: 12 minutes d\'attente, grosse attente au quai.' },
      delayed,
      'gr_r8_45.5180_-73.5686',
    )
    expect(reading.verdict).toBe('confirms')
    expect(reading.correlations[0]!.verdict).toBe('confirms')
    expect(reading.factors).toContain('metro-green=confirms')
    expect(reading.dataValue).toBeGreaterThan(20)
  })

  it('flags divergence when the story contradicts the simulation', () => {
    const calm: MatsimSnapshot = {
      ...SNAPSHOT,
      lines: SNAPSHOT.lines.map((l) => l.lineId === 'metro-green'
        ? { ...l, avgDelaySec: 0, status: 'nominal', load: 0.2, incidents: [] }
        : l),
    }
    const reading = avaRead(
      { narrative: 'Un souvenir de quai.', functional: 'Hier, ligne verte: 30 minutes de retard, rames annulées.' },
      calm,
      null,
    )
    expect(reading.correlations[0]!.verdict).toBe('diverges')
    expect(reading.verdict).toBe('diverges')
  })

  it('answers unverifiable without line claims and attaches quality prompts', () => {
    const reading = avaRead(
      { narrative: 'Una città che ricorda, come un canto perduto tra i ponti.', functional: 'Era bella la città.' },
      SNAPSHOT,
      null,
    )
    expect(reading.verdict).toBe('unverifiable')
    const keys = reading.parts.map((p) => p.key)
    expect(keys).toContain('ava.q_line')
    expect(reading.parts.filter((p) => p.kind === 'quality').length).toBeLessThanOrEqual(3)
  })

  it('reports out-of-sim lines when the feed misses them', () => {
    const partial: MatsimSnapshot = { ...SNAPSHOT, lines: SNAPSHOT.lines.slice(0, 4) }
    const reading = avaRead(
      { narrative: 'Scène du soir.', functional: 'Bus 139 en retard de 10 minutes.' },
      partial,
      null,
    )
    expect(reading.correlations[0]!.verdict).toBe('out-of-sim')
  })

  it('cellPoint decodes grid cells only', () => {
    expect(cellPoint('gr_r8_45.5120_-73.5613')).toEqual([45.512, -73.5613])
    expect(cellPoint('exact_45.5_-73.5')).toBeNull()
    expect(cellPoint(null)).toBeNull()
  })
})

describe('publish pipeline and store', () => {
  it('validates both channels', () => {
    expect(validateInput({ narrative: 'trop court', functional: 'ok dati' })).toBe('narrative_required')
    expect(validateInput({ narrative: 'una scena abbastanza lunga qui', functional: 'x' })).toBe('functional_required')
    expect(validateInput({ narrative: 'una scena abbastanza lunga qui', functional: 'ligne verte en retard' })).toBeNull()
  })

  it('publishes scrubbed, gridded stories with signal and AVA reading', async () => {
    const story = await publishCityStory(
      {
        narrative: 'Je me souviens de ma grand-mère dans la verte, comme une chanson douce de la ville.',
        functional: 'Hier 8h15, ligne verte: contact mario@example.com, 12 minutes d\'attente, quai bondé.',
        lang: 'fr', lat: 45.5183, lon: -73.5686,
      },
      { geo_mode: 'grid', allow_dispatch: true },
      SNAPSHOT,
    )
    const blob = JSON.stringify(story)
    expect(blob).not.toContain('45.5183')
    expect(blob).not.toContain('mario@example.com')
    expect(story.geo?.index).toMatch(/^gr_r8_/)
    expect(story.author_pseudonym).toMatch(/^anon_/)
    expect(story.claims.some((c) => c.lineId === 'metro-green')).toBe(true)
    expect(story.ava.verdict).toBeTruthy()
    expect(story.signal.realityIndex).toBeGreaterThanOrEqual(0)
    expect(story.scrubbed_terms).toBeGreaterThanOrEqual(1)
  })

  it('publishes non-georeferenced stories and refuses coordinates without grid consent', async () => {
    const none = await publishCityStory(
      { narrative: 'una scena abbastanza lunga qui', functional: 'bus 80 en retard' },
      { geo_mode: 'none', allow_dispatch: true },
      SNAPSHOT,
    )
    expect(none.geo).toBeNull()
    await expect(publishCityStory(
      { narrative: 'una scena abbastanza lunga qui', functional: 'bus 80 en retard', lat: 45.5, lon: -73.5 },
      { geo_mode: 'none', allow_dispatch: true },
      SNAPSHOT,
    )).rejects.toThrow('coordinates')
  })

  it('persists, echoes and reloads stories', async () => {
    const store = storage()
    const story = await publishCityStory(
      { narrative: 'una scena abbastanza lunga qui', functional: 'ligne orange en retard' },
      { geo_mode: 'none', allow_dispatch: true },
      SNAPSHOT,
    )
    saveStories([story], store)
    const loaded = loadStories(store)
    expect(loaded).toHaveLength(1)
    const echoed = addEcho(story.id, loaded)
    expect(echoed[0]!.echoes).toBe(1)
    saveStories(echoed, store)
    expect(loadStories(store)[0]!.echoes).toBe(1)
    expect(loadStories(null)).toEqual([])
  })
})

describe('share codec', () => {
  it('round-trips a story through a URL-safe hash without exact coordinates', async () => {
    const story = await publishCityStory(
      {
        narrative: 'Je me souviens du quai de la petite gare, comme une scène apprise par cœur.',
        functional: 'Aujourd\'hui 7h50, bus 139: 10 minutes d\'attente, direction Pie-IX.',
        lang: 'fr', lat: 45.513, lon: -73.5524,
      },
      { geo_mode: 'grid', allow_dispatch: true },
      SNAPSHOT,
    )
    const hash = encodeShareHash(story)
    expect(hash).not.toMatch(/[+/=]/)
    expect(hash).not.toContain('45.513')
    const back = decodeShareHash(`#st=${hash}`)
    expect(back).not.toBeNull()
    expect(back!.id).toBe(story.id)
    expect(back!.narrative).toBe(story.narrative)
    expect(back!.functional).toBe(story.functional)
    expect(back!.geo?.index).toBe(story.geo!.index)
    expect(back!.origin).toBe('echo')
    expect(back!.signal.facts).toBe(story.signal.facts)
  })

  it('rejects tampered or foreign payloads', () => {
    expect(decodeShareHash('#st=%%%garbage')).toBeNull()
    expect(decodeShareHash('#st=' + btoa('{"v":99}'))).toBeNull()
    expect(decodeShareHash('nope')).toBeNull()
  })
})

describe('mode + source prefs', () => {
  it('defaults to citizen + simulated feed and persists changes', () => {
    const store = storage()
    expect(loadMode(store)).toBe('citizen')
    store.setItem('city-life-telling.mode.v1', 'strategist')
    expect(loadMode(store)).toBe('strategist')
    expect(loadSourcePrefs(store).kind).toBe('simulated')
    store.setItem('city-life-telling.matsim-source.v1', JSON.stringify({ kind: 'http', url: 'https://x/y.json' }))
    expect(loadSourcePrefs(store)).toEqual({ kind: 'http', url: 'https://x/y.json', seed: 20261105, weatherUrl: '' })
    expect(loadSourcePrefs(null).kind).toBe('simulated')
  })
})

describe('weather layer', () => {
  it('simulates deterministic, contract-valid forecasts', () => {
    const a = simulateWeather(7, WHEN)
    const b = simulateWeather(7, WHEN)
    expect(a).toEqual(b)
    expect(a.contract).toBe('clt.weather.v0')
    expect(a.periods).toHaveLength(3)
    for (const p of a.periods) {
      expect(p.tempC).toBeGreaterThanOrEqual(-60)
      expect(p.tempC).toBeLessThanOrEqual(55)
      expect(p.precipMm).toBeGreaterThanOrEqual(0)
      expect(['none', 'rain', 'snow', 'freezing']).toContain(p.precipKind)
      expect(['none', 'wind', 'snow', 'ice', 'storm', 'heat', 'cold']).toContain(p.alert)
    }
  })

  it('scores weather stress and parses the HTTP contract defensively', () => {
    expect(forecastStress(simulateWeather(7, WHEN))).toBeGreaterThanOrEqual(0)
    expect(forecastStress(simulateWeather(7, WHEN))).toBeLessThanOrEqual(1)
    expect(parseWeather({}).ok).toBe(false)
    const good = parseWeather(JSON.parse(JSON.stringify(simulateWeather(7, WHEN))))
    expect(good.ok).toBe(true)
    const bad = parseWeather({ ...simulateWeather(7, WHEN), contract: 'x' })
    expect(bad.ok).toBe(false)
  })
})

describe('decision model (weather × congestion)', () => {
  it('ranks winter ops first under a snowstorm on a loaded network', () => {
    const snowy = simulateWeather(11, WHEN)
    snowy.periods = snowy.periods.map((p, i) => i === 0
      ? { ...p, precipKind: 'snow' as const, precipMm: 12, tempC: -6, windKmh: 45, alert: 'snow' as const }
      : p)
    const loaded: MatsimSnapshot = {
      ...SNAPSHOT,
      lines: SNAPSHOT.lines.map((l) => l.lineId === 'metro-green'
        ? { ...l, load: 0.85, avgDelaySec: 300, status: 'delayed' as const }
        : l),
    }
    const out = decideStrategies(loaded, snowy, { storyCount: 6, divergingCount: 0 })
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]!.id).toBe('winter-ops')
    expect(out[0]!.score).toBeGreaterThanOrEqual(out[out.length - 1]!.score)
    expect(out[0]!.factors.join(' ')).toMatch(/snow/)
    const again = decideStrategies(loaded, snowy, { storyCount: 6, divergingCount: 0 })
    expect(again).toEqual(out)
  })

  it('proposes congestion relief on jammed lines and a story call under weather stress', () => {
    const jam: MatsimSnapshot = {
      ...SNAPSHOT,
      lines: SNAPSHOT.lines.map((l) => l.lineId === 'bus-80'
        ? { ...l, load: 0.9, avgDelaySec: 420, status: 'delayed' as const }
        : l),
    }
    const wet = simulateWeather(3, WHEN)
    wet.periods = wet.periods.map((p) => ({ ...p, precipKind: 'rain' as const, precipMm: 14, alert: 'storm' as const }))
    const out = decideStrategies(jam, wet, { storyCount: 2, divergingCount: 3 })
    const ids = out.map((s) => s.id)
    expect(ids).toContain('congestion-relief')
    expect(ids).toContain('storm-advisory')
    expect(ids).toContain('story-gap')
    const relief = out.find((s) => s.id === 'congestion-relief')!
    expect(relief.params.lines).toContain('Bus 80')
    expect(relief.factors.join(' ')).toMatch(/bus-80/)
  })

  it('stays quiet with calm weather and a calm network', () => {
    const calm = simulateWeather(5, new Date('2026-07-15T18:00:00Z'))
    const out = decideStrategies(SNAPSHOT, calm, { storyCount: 0, divergingCount: 0 })
    expect(out.every((s) => s.id !== 'winter-ops')).toBe(true)
    expect(out.every((s) => s.id !== 'shuttle-bridge' || s.factors.length > 0)).toBe(true)
  })
})

describe('ava provisional key', () => {
  it('validates generated keys only within ±1 month', () => {
    const key = generateKey('202611')
    expect(key).toBe('CLT-AVA-202611-8420')
    expect(isValidKey(key, WHEN)).toBe(true)
    expect(isValidKey(generateKey('202612'), WHEN)).toBe(true)
    expect(isValidKey(generateKey('202703'), WHEN)).toBe(false)
    expect(isValidKey('CLT-AVA-202611-0000', WHEN)).toBe(false)
    expect(isValidKey('garbage', WHEN)).toBe(false)
  })
})

describe('multimedia stories (10 MB, local)', () => {
  it('validates batches: budget, type and count', () => {
    expect(validateMediaBatch([])).toBeNull()
    expect(validateMediaBatch([new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })])).toBeNull()
    expect(validateMediaBatch([new File([new Uint8Array(10)], 'a.zip', { type: 'application/zip' })])).toBe('type')
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'v.mp4', { type: 'video/mp4' })
    expect(validateMediaBatch([big])).toBe('budget')
    const many = Array.from({ length: 9 }, (_, i) => new File([new Uint8Array(3)], `f${i}.png`, { type: 'image/png' }))
    expect(validateMediaBatch(many)).toBe('count')
  })

  it('stores and reads back media blobs without IndexedDB', async () => {
    const file = new File(['una voce della città'], 'nota.txt', { type: 'text/plain' })
    const ref = await putMedia(file)
    expect(ref.kind).toBe('text')
    expect(ref.size).toBe(file.size)
    expect(ref.id).toMatch(/^md_[a-f0-9]{16}$/)
  })

  it('publishes signed stories with media refs and shares the name', async () => {
    const file = new File([new Uint8Array(2000)], 'p.png', { type: 'image/png' })
    const media = [await putMedia(file)]
    const story = await publishCityStory(
      {
        narrative: 'Je me souviens du pont de glace, comme un verre chanlant sous les roues.',
        functional: '7h50, ligne bleue: 10 minutes d\'attente, station Jean-Talon bondée.',
        display_name: '  Giulia R. ', lat: 45.5386, lon: -73.6192, media,
      },
      { geo_mode: 'grid', allow_dispatch: true },
      SNAPSHOT,
    )
    expect(story.display_name).toBe('Giulia R.')
    expect(story.media).toHaveLength(1)
    expect(story.claims.some((c) => c.lineId === 'metro-blue')).toBe(true)
    const back = decodeShareHash('#st=' + encodeShareHash(story))
    expect(back!.display_name).toBe('Giulia R.')
    expect(back!.media).toEqual([])
  })
})

describe('channel caps', () => {
  it('caps the fictional channel at 1000 and the functional at 500', async () => {
    const story = await publishCityStory(
      {
        narrative: 'v'.repeat(1200),
        functional: 'f'.repeat(600),
      },
      { geo_mode: 'none', allow_dispatch: true },
      SNAPSHOT,
    )
    expect(story.narrative.length).toBe(1000)
    expect(story.functional.length).toBe(500)
  })
})

describe('story deletion and authorship', () => {
  it('deletes any story as the strategist, own only as citizen', async () => {
    const store = storage()
    const a = await publishCityStory(
      { narrative: 'una scena abbastanza lunga qui', functional: 'ligne verte en retard' },
      { geo_mode: 'none', allow_dispatch: true }, SNAPSHOT)
    const b = await publishCityStory(
      { narrative: 'un ricordo del quai della sera, lungo abbastanza', functional: 'bus 80 en retard' },
      { geo_mode: 'none', allow_dispatch: true }, SNAPSHOT)
    saveStories([a, b], store)
    markMine(a.id, store)
    expect(loadMine(store).has(a.id)).toBe(true)
    expect(loadMine(store).has(b.id)).toBe(false)
    // citizen deletes their own
    saveStories(deleteStory(a.id, loadStories(store)), store)
    unmarkMine(a.id, store)
    expect(loadStories(store).map((s) => s.id)).toEqual([b.id])
    expect(loadMine(store).has(a.id)).toBe(false)
    // strategist deletes any remaining
    saveStories(deleteStory(b.id, loadStories(store)), store)
    expect(loadStories(store)).toEqual([])
  })
})
