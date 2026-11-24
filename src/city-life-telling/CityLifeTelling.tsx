import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  MONTREAL_CENTER,
  MONTREAL_ZOOM,
  SEED_LINES,
} from './matsim/network.js'
import { HttpMatsimSource } from './matsim/http-source.js'
import { agentDensity, generateAgents, type SimAgent } from './matsim/agents.js'
import {
  AGENT_BUDGET_MAX,
  AGENT_BUDGET_MIN,
  CITY_AGENT_BUDGET_MAX,
  DEFAULT_CALIBRATION,
  EMPHASIS_PRESETS,
  FOCUS_PRESETS,
  applyCalibration,
  clockBreakdown,
  loadCalibration,
  saveCalibration,
  type CalibrationConfig,
  type ClockKey,
} from './matsim/calibration.js'
import { SimulatedMatsimSource } from './matsim/simulated-source.js'
import type { MatsimSnapshot, MatsimSource, ServiceStatus } from './matsim/types.js'
import { avaRead, type AvaPart, type AvaReading, type AvaVerdict, type ClaimVerdict } from './ava-agent.js'
import { isValidKey } from './ava-key.js'
import {
  deleteMedia,
  MEDIA_TOTAL_BUDGET,
  mediaUrl,
  putMedia,
  totalSize,
  validateMediaBatch,
  type ClMediaRef,
} from './media-db.js'
import {
  HttpWeatherSource,
  SimulatedWeatherSource,
  forecastStress,
  type WeatherForecast,
} from './weather.js'
import { decideStrategies, type Strategy } from './strategy.js'
import AgentConsole from './AgentConsole'
import { promptRefOf, simulationPrompts, type SimulationPrompt } from './prompts.js'
import {
  addEcho,
  decodeShareHash,
  deleteStory,
  encodeShareHash,
  loadAvaKey,
  loadMine,
  loadMode,
  loadSourcePrefs,
  loadStories,
  markMine,
  MAX_FICTIONAL,
  MAX_FUNCTIONAL,
  publishCityStory,
  saveAvaKey,
  saveMode,
  saveSourcePrefs,
  saveStories,
  unmarkMine,
  type AppMode,
  type CityStory,
  type SourcePrefs,
} from './store.js'
import { alertWord, bandWord, claimWord, loadUiLang, precipWord, statusWord, storeUiLang, weatherPeriodWord, STR, type UiLang } from './i18n.js'
import './city-life-telling.css'

type Filter = 'all' | 'balanced' | 'facts' | 'fiction'

const STATUS_COLOR: Record<ServiceStatus, string | null> = {
  nominal: null, // resolved per line below
  irregular: '#f2c14e', delayed: '#f08c00', disrupted: '#d6409f', suspended: '#8a8a8a',
}

const BAND_COLOR: Record<string, string> = {
  'saturated-fiction': '#c46bff', 'narrative-leaning': '#9a7bff',
  balanced: '#4fb5ae', 'fact-leaning': '#57a33d', 'saturated-facts': '#2f9e44',
}

function cellToLatLng(cell: string | null | undefined): [number, number] | null {
  if (!cell || !cell.startsWith('gr_')) return null
  const parts = cell.split('_')
  const lat = Number.parseFloat(parts[2] ?? '')
  const lon = Number.parseFloat(parts[3] ?? '')
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null
}

function lineLabelOf(lineId: string): string {
  return SEED_LINES.find((l) => l.id === lineId)?.label ?? lineId
}

const PRESETS = [
  {
    label: 'FR · ligne verte, matin',
    lang: 'fr',
    narrative: 'Ce matin, à la station Sherbrooke, une femme chantonnait en attendant la verte. J\'ai pensé à ma grand-mère qui prenait le même métro il y a quarante ans.',
    functional: '8h15, ligne verte direction Honoré-Beaugrand: 12 minutes d\'attente, quai bondé à Sherbrooke, deux rames sautées.',
  },
  {
    label: 'EN · bus 80, night shift',
    lang: 'en',
    narrative: 'The night bus on Du Parc smells of rain and fried dough. The driver hums, the city exhales. I ride it like a lullaby between two jobs.',
    functional: '11h40 pm, bus 80 northbound: 25 minutes delay at Mont-Royal, crowded, driver apologising for a gap in service.',
  },
  {
    label: 'IT · REM, la laurea',
    lang: 'it',
    narrative: 'Ho preso il REM la sera della laurea di mia sorella, a Brossard. Sembrava un filo d\'argento teso sul fiume: come un\'orchestra che parte in ritardo ma suona bene.',
    functional: '19h05, REM verso Brossard: partenza in ritardo di 6 minuti, carico medio, nessun incidente segnalato.',
  },
]

/** Renders the local media of a story from IndexedDB (object URLs). */
function StoryMedia({ media }: { media: ClMediaRef[] }) {
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  useEffect(() => {
    let alive = true
    for (const m of media) {
      void mediaUrl(m).then((url) => { if (alive) setUrls((prev) => ({ ...prev, [m.id]: url })) })
    }
    return () => { alive = false }
  }, [media])
  if (media.length === 0) return null
  return (
    <div className="clt-wall-media">
      {media.map((m) => {
        const url = urls[m.id]
        if (!url) return <span key={m.id} className="clt-wall-id">{m.kind} · {(m.size / 1024).toFixed(0)} kB</span>
        if (m.kind === 'image') return <img key={m.id} src={url} alt="story media" loading="lazy" />
        if (m.kind === 'video') return <video key={m.id} src={url} controls preload="metadata" />
        if (m.kind === 'audio') return <audio key={m.id} src={url} controls preload="metadata" />
        return <a key={m.id} className="clt-wall-id" href={url} target="_blank" rel="noreferrer">testo ↗</a>
      })}
    </div>
  )
}

export default function CityLifeTelling({ initialMode }: { initialMode?: AppMode } = {}) {
  useEffect(() => {
    document.documentElement.classList.add('clt-route')
    return () => document.documentElement.classList.remove('clt-route')
  }, [])

  const storage = typeof window !== 'undefined' ? window.localStorage : null
  const mapDiv = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const storyLayer = useRef<L.LayerGroup | null>(null)
  const pinRef = useRef<L.CircleMarker | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const [ui, setUi] = useState<UiLang>(() => loadUiLang(storage))
  const [mode, setMode] = useState<AppMode>(() => initialMode ?? loadMode(storage))
  const t = STR[ui]

  const [prefs, setPrefs] = useState<SourcePrefs>(() => loadSourcePrefs(storage))
  const [urlDraft, setUrlDraft] = useState(prefs.url)
  const [weatherUrlDraft, setWeatherUrlDraft] = useState(prefs.weatherUrl)
  const [seedDraft, setSeedDraft] = useState(String(prefs.seed))
  const [paused, setPaused] = useState(false)
  const [snapshot, setSnapshot] = useState<MatsimSnapshot | null>(null)
  const [forecast, setForecast] = useState<WeatherForecast | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [strategies, setStrategies] = useState<Strategy[] | null>(null)
  const [calibration, setCalibration] = useState<CalibrationConfig>(() => loadCalibration(storage))
  const [agents, setAgents] = useState<SimAgent[]>([])

  const [stories, setStories] = useState<CityStory[]>(() => loadStories(storage))
  const [mine, setMine] = useState<Set<string>>(() => loadMine(storage))
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)

  const [point, setPoint] = useState<[number, number]>(MONTREAL_CENTER)
  const [narrative, setNarrative] = useState('')
  const [functional, setFunctional] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [lang, setLang] = useState('fr')
  const [forcedLine, setForcedLine] = useState('auto')
  const [geoMode, setGeoMode] = useState<'grid' | 'none'>('grid')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [promptRef, setPromptRef] = useState<SimulationPrompt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /* AVA box: opens with a provisional key generated with the assistant. */
  const [avaKey, setAvaKey] = useState<string | null>(() => loadAvaKey(storage))
  const [keyDraft, setKeyDraft] = useState('')
  const [keyError, setKeyError] = useState(false)
  const avaOpen = avaKey !== null && isValidKey(avaKey)

  const switchUi = useCallback((next: UiLang) => {
    setUi(next)
    storeUiLang(next, storage)
  }, [storage])

  const switchMode = useCallback((next: AppMode) => {
    setMode(next)
    saveMode(next, storage)
  }, [storage])

  const unlockAva = useCallback(() => {
    const key = keyDraft.trim()
    if (isValidKey(key)) {
      saveAvaKey(key, storage)
      setAvaKey(key)
      setKeyError(false)
      setKeyDraft('')
    } else {
      setKeyError(true)
    }
  }, [keyDraft, storage])

  /* Live source lifecycle: one adapter at a time, recreated on prefs change. */
  useEffect(() => {
    if (paused) return
    const source: MatsimSource = prefs.kind === 'http'
      ? new HttpMatsimSource({ url: prefs.url, pollMs: 10000 })
      : new SimulatedMatsimSource({ seed: prefs.seed, tickMs: 6000 })
    source.start((s) => { setSnapshot(s); setFeedError(null) },
      (e) => setFeedError(e.message))
    return () => source.stop()
  }, [prefs.kind, prefs.url, prefs.seed, paused])

  /* Parametric calibration of the live feed: four clocks + focus area. */
  const calibrated = useMemo(() => {
    if (!snapshot) return null
    return applyCalibration(snapshot, calibration, new Date(snapshot.generatedAt))
  }, [snapshot, calibration])

  /* Weather lifecycle: HTTP endpoint when configured, else the simulated feed. */
  useEffect(() => {
    const source = prefs.weatherUrl.trim() !== ''
      ? new HttpWeatherSource(prefs.weatherUrl.trim())
      : new SimulatedWeatherSource(prefs.seed)
    source.start(setForecast, () => undefined)
    return () => source.stop()
  }, [prefs.seed, prefs.weatherUrl])

  /* Map setup (once). */
  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return
    const map = L.map(mapDiv.current, { center: MONTREAL_CENTER, zoom: MONTREAL_ZOOM })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    storyLayer.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => setPoint([e.latlng.lat, e.latlng.lng]))
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; storyLayer.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Local anchor pin. */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    pinRef.current?.remove()
    pinRef.current = L.circleMarker(point, {
      radius: 9, color: '#ffffff', weight: 2, fillColor: '#1d6f6a', fillOpacity: 0.9,
    }).addTo(map).bindTooltip(t.storyPin)
  }, [point, t])

  /* Story pins. */
  useEffect(() => {
    const layer = storyLayer.current
    if (!layer) return
    layer.clearLayers()
    for (const story of stories) {
      const cell = cellToLatLng(story.geo?.index)
      if (!cell) continue
      L.circleMarker(cell, {
        radius: 7, color: '#ffffff', weight: 2, fillColor: BAND_COLOR[story.signal.band] ?? '#4fb5ae', fillOpacity: 0.9,
      }).addTo(layer)
        .bindTooltip(`R${story.signal.realityIndex} · ${story.id}`)
        .on('click', () => setSelected(story.id))
    }
  }, [stories])

  /* Shared-link import (once per mount). */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash.startsWith('#st=')) return
    const imported = decodeShareHash(window.location.hash)
    if (!imported) return
    setStories((prev) => {
      if (prev.some((s) => s.id === imported.id || (s.geo !== null && imported.geo !== null && s.geo.index === imported.geo.index && s.text_hash === imported.text_hash))) return prev
      const next = [imported, ...prev]
      saveStories(next, storage)
      return next
    })
    setSelected(imported.id)
    window.history.replaceState(null, '', window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clockNow = useMemo(() => new Date(calibrated?.generatedAt ?? Date.now()), [calibrated])
  const density = useMemo(() => (calibrated ? agentDensity(calibrated) : []), [calibrated])
  const breakdown = useMemo(() => clockBreakdown(calibration, clockNow), [calibration, clockNow])

  useEffect(() => { saveCalibration(calibration, storage) }, [calibration, storage])

  /* Current agents: regenerated per calibrated tick, contained by focus + budget. */
  useEffect(() => {
    if (!calibrated) { setAgents([]); return }
    setAgents(generateAgents(calibrated, calibration, calibrated.tick))
  }, [calibrated, calibration])

  const setClock = useCallback((key: ClockKey, value: number) => {
    setCalibration((prev) => ({ ...prev, emphasis: 'custom', clocks: { ...prev.clocks, [key]: value } }))
  }, [])

  const setFrame = useCallback((key: ClockKey) => {
    setCalibration((prev) => ({ ...prev, emphasis: key, clocks: { ...EMPHASIS_PRESETS[key] } }))
  }, [])

  const rangeRow = (label: string, value: number, display: string, min: number, max: number, step: number, onChange: (v: number) => void) => (
    <label className="clt-range">
      <span>{label} <b>{display}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )

  const filtered = useMemo(() => {
    const sorted = [...stories].sort((a, b) => b.ava.dataValue - a.ava.dataValue || b.ts.localeCompare(a.ts))
    if (filter === 'balanced') return sorted.filter((s) => s.signal.band === 'balanced')
    if (filter === 'facts') return sorted.filter((s) => s.signal.realityIndex >= 58)
    if (filter === 'fiction') return sorted.filter((s) => s.signal.realityIndex < 42)
    return sorted
  }, [stories, filter])

  const selectedStory = stories.find((s) => s.id === selected) ?? null

  /* AVA reading, always against the live snapshot. */
  const reading: AvaReading | null = useMemo(() => {
    if (!selectedStory) return null
    return avaRead(selectedStory, calibrated, selectedStory.geo?.index ?? null, selectedStory.signal)
  }, [selectedStory, calibrated])

  /* Simulation → collection loop: anomalies become neutral prompts. */
  const prompts = useMemo(
    () => simulationPrompts(calibrated, 3, calibration.scope === 'focus' ? calibration.focus : undefined),
    [calibrated, calibration.focus, calibration.scope],
  )

  const useSimPrompt = useCallback((prompt: SimulationPrompt) => {
    setPromptRef(prompt)
    setForcedLine(prompt.lineId)
    setFunctional((prev) => (prev.length > 0 ? prev : t.simPromptSeed(prompt.lineLabel)))
  }, [t])

  const pickPreset = useCallback((preset: typeof PRESETS[number]) => {
    setNarrative(preset.narrative)
    setFunctional(preset.functional)
    setLang(preset.lang)
  }, [])

  const pickFiles = useCallback((list: FileList | null) => {
    const files = list ? Array.from(list) : []
    const invalid = validateMediaBatch(files)
    if (invalid) {
      setError(invalid === 'budget' ? t.budgetErr : invalid === 'count' ? t.countErr : t.typeErr)
      return
    }
    setError(null)
    setPendingFiles(files)
  }, [t])

  const publish = useCallback(async () => {
    setError(null)
    setNotice(null)
    if (narrative.trim().length < 16) { setError(t.errorNarrative(narrative.trim().length)); return }
    if (functional.trim().length < 8) { setError(t.errorFunctional(functional.trim().length)); return }
    setBusy(true)
    try {
      const media: ClMediaRef[] = []
      for (const file of pendingFiles) media.push(await putMedia(file))
      const story = await publishCityStory(
        {
          narrative, functional, lang,
          lat: geoMode === 'grid' ? point[0] : null,
          lon: geoMode === 'grid' ? point[1] : null,
          forced_line: forcedLine === 'auto' ? null : forcedLine,
          display_name: displayName.trim() || null,
          media,
          prompt_ref: promptRef ? promptRefOf(promptRef) : null,
        },
        { geo_mode: geoMode, allow_dispatch: true },
        calibrated,
      )
      setStories((prev) => {
        const next = [story, ...prev]
        saveStories(next, storage)
        return next
      })
      markMine(story.id, storage)
      setMine((prev) => new Set(prev).add(story.id))
      setSelected(story.id)
      setNarrative('')
      setFunctional('')
      setDisplayName('')
      setPendingFiles([])
      setPromptRef(null)
      setNotice(t.published)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'consent'
      setError(message === 'narrative_required' ? t.errorNarrative(narrative.trim().length)
        : message === 'functional_required' ? t.errorFunctional(functional.trim().length)
        : message === 'coordinates' ? t.errorCoordinates
        : message.startsWith('media') ? t.budgetErr
        : t.errorConsent)
    } finally {
      setBusy(false)
    }
  }, [narrative, functional, displayName, lang, geoMode, point, forcedLine, pendingFiles, calibrated, t, storage])

  const echo = useCallback((id: string) => {
    setStories((prev) => {
      const next = addEcho(id, prev)
      saveStories(next, storage)
      return next
    })
  }, [storage])

  /* Author deletes their own story; the Urban Strategist deletes any. */
  const remove = useCallback((story: CityStory) => {
    if (!window.confirm(t.deleteConfirm(story.id))) return
    for (const m of story.media ?? []) void deleteMedia(m.id)
    setStories((prev) => {
      const next = deleteStory(story.id, prev)
      saveStories(next, storage)
      return next
    })
    setMine((prev) => {
      if (!prev.has(story.id)) return prev
      unmarkMine(story.id, storage)
      const next = new Set(prev)
      next.delete(story.id)
      return next
    })
    setSelected((sel) => (sel === story.id ? null : sel))
    setNotice(t.deletedNotice)
  }, [t, storage])

  const shareUrl = useCallback((story: CityStory) => {
    return `${window.location.origin}${window.location.pathname}#st=${encodeShareHash(story)}`
  }, [])

  const share = useCallback(async (story: CityStory) => {
    const url = shareUrl(story)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'City-Life-Telling', text: story.narrative.slice(0, 140), url })
        return
      } catch {
        // user aborted or share failed → fall through to copy
      }
    }
    void navigator.clipboard?.writeText(url).catch(() => undefined)
    window.prompt(t.copyLink, url)
  }, [shareUrl, t])

  const copyLink = useCallback((story: CityStory) => {
    void navigator.clipboard?.writeText(shareUrl(story)).catch(() => undefined)
    window.prompt(t.copyLink, shareUrl(story))
  }, [shareUrl, t])

  const reply = useCallback((story: CityStory) => {
    setFunctional((prev) => (prev.length > 0 ? prev : t.replyPrefill(story.id)))
    document.querySelector('[data-testid="composer"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [t])

  /** Social feeds: X and Facebook share intents; Instagram has no web
   *  intent — the story link is copied, then Instagram opens. */
  const social = useCallback((story: CityStory, network: 'x' | 'facebook' | 'instagram') => {
    const url = shareUrl(story)
    const snippet = story.narrative.slice(0, 200)
    if (network === 'x') {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(snippet)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener')
      return
    }
    if (network === 'facebook') {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(snippet)}`, '_blank', 'noopener')
      return
    }
    void navigator.clipboard?.writeText(`${snippet}\n${url}`).catch(() => undefined)
    window.open('https://www.instagram.com/', '_blank', 'noopener')
  }, [shareUrl])

  const applySource = useCallback(() => {
    const seed = Number.parseInt(seedDraft, 10)
    const next: SourcePrefs = {
      kind: prefs.kind,
      url: prefs.kind === 'http' ? urlDraft.trim() : prefs.url,
      seed: Number.isFinite(seed) ? seed : prefs.seed,
      weatherUrl: weatherUrlDraft.trim(),
    }
    setPrefs(next)
    setStrategies(null)
    saveSourcePrefs(next, storage)
  }, [prefs.kind, prefs.url, weatherUrlDraft, seedDraft, storage])

  /* The decision model: weather × congestion × community, on demand. */
  const askStrategies = useCallback(() => {
    setStrategies(decideStrategies(calibrated, forecast, {
      storyCount: stories.length,
      divergingCount: stories.filter((s) => s.ava.verdict === 'diverges').length,
    }))
  }, [calibrated, forecast, stories])

  const exportJson = useCallback(() => {
    const payload = {
      document: 'city-life-telling.research-export.v1',
      exportedAt: new Date().toISOString(),
      settings: { prefs, mode, ui },
      calibration,
      snapshot: calibrated,
      weather: forecast,
      stories,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `city-life-telling-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [calibrated, calibration, prefs, mode, ui, forecast, stories])

  /* Strategist aggregates. */
  const kpis = useMemo(() => {
    if (!calibrated) return null
    const delays = calibrated.lines.map((l) => l.avgDelaySec)
    return {
      onboard: calibrated.agents.onboard,
      waiting: calibrated.agents.waiting,
      avgTripMin: calibrated.agents.avgTripMin,
      avgDelay: Math.round(delays.reduce((a, n) => a + n, 0) / Math.max(1, delays.length)),
      disrupted: calibrated.lines.filter((l) => l.status === 'disrupted' || l.status === 'suspended').length,
      load: Math.round((calibrated.lines.reduce((a, l) => a + l.load, 0) / Math.max(1, calibrated.lines.length)) * 100),
    }
  }, [calibrated])

  const histogram = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0]
    for (const s of stories) buckets[Math.min(4, Math.floor(s.signal.realityIndex / 20))] += 1
    return buckets
  }, [stories])

  const verdictCounts = useMemo(() => {
    const counts: Record<string, number> = { confirms: 0, partially: 0, diverges: 0, unverifiable: 0 }
    for (const s of stories) counts[s.ava.verdict] = (counts[s.ava.verdict] ?? 0) + 1
    return counts
  }, [stories])

  const crossRows = useMemo(() => {
    return filtered.filter((s) => s.claims.length > 0).slice(0, 40).map((story) => ({
      story,
      live: avaRead(story, calibrated, story.geo?.index ?? null, story.signal),
    }))
  }, [filtered, calibrated])

  const verdictShort = useCallback((verdict: AvaVerdict | ClaimVerdict): string => {
    switch (verdict) {
      case 'confirms': return t.verdictShortConfirms
      case 'partially': return t.verdictShortPartially
      case 'diverges': return t.verdictShortDiverges
      default: return t.verdictShortUnverifiable
    }
  }, [t])

  const renderPart = useCallback((part: AvaPart, index: number) => {
    const p = part.params ?? {}
    switch (part.key) {
      case 'ava.verdict.confirms': return <p key={index} className="clt-ava-line clt-verdict confirms">{t.avaVerdictConfirms}</p>
      case 'ava.verdict.partially': return <p key={index} className="clt-ava-line clt-verdict partially">{t.avaVerdictPartially}</p>
      case 'ava.verdict.diverges': return <p key={index} className="clt-ava-line clt-verdict diverges">{t.avaVerdictDiverges}</p>
      case 'ava.verdict.unverifiable': return <p key={index} className="clt-ava-line clt-verdict unverifiable">{t.avaVerdictUnverifiable}</p>
      case 'ava.corr.confirms': return <p key={index} className="clt-ava-line">{t.avaCorrConfirms({ line: String(p.line), status: statusWord(t, String(p.status)), delay: Number(p.delay), load: Number(p.load), near: Number(p.near) })}</p>
      case 'ava.corr.partially': return <p key={index} className="clt-ava-line">{t.avaCorrPartially({ line: String(p.line), status: statusWord(t, String(p.status)), delay: Number(p.delay), load: Number(p.load), near: Number(p.near) })}</p>
      case 'ava.corr.diverges': return <p key={index} className="clt-ava-line">{t.avaCorrDiverges({ line: String(p.line), status: statusWord(t, String(p.status)), delay: Number(p.delay), load: Number(p.load), near: Number(p.near) })}</p>
      case 'ava.corr.out-of-sim': return <p key={index} className="clt-ava-line">{t.avaCorrOutOfSim({ line: String(p.line) })}</p>
      case 'ava.drama.figurative': return <p key={index} className="clt-ava-line clt-drama">{t.avaDramaFigurative({ motif: String(p.motif ?? '') })}</p>
      case 'ava.drama.emotional': return <p key={index} className="clt-ava-line clt-drama">{t.avaDramaEmotional({ motif: String(p.motif ?? '') })}</p>
      case 'ava.drama.narrative': return <p key={index} className="clt-ava-line clt-drama">{t.avaDramaNarrative({ motif: String(p.motif ?? '') })}</p>
      case 'ava.drama.sparse': return <p key={index} className="clt-ava-line clt-drama">{t.avaDramaSparse}</p>
      case 'ava.q_time': return <p key={index} className="clt-ava-line clt-quality">{t.avaQTime}</p>
      case 'ava.q_quantity': return <p key={index} className="clt-ava-line clt-quality">{t.avaQQuantity}</p>
      case 'ava.q_line': return <p key={index} className="clt-ava-line clt-quality">{t.avaQLine}</p>
      case 'ava.q_place': return <p key={index} className="clt-ava-line clt-quality">{t.avaQPlace}</p>
      case 'ava.share_data': return <p key={index} className="clt-ava-line clt-share">{t.avaShareData({ facts: Number(p.facts), fiction: Number(p.fiction) })}</p>
      case 'ava.share_story': return <p key={index} className="clt-ava-line clt-share">{t.avaShareStory({ facts: Number(p.facts), fiction: Number(p.fiction) })}</p>
      default: return null
    }
  }, [t])

  const strategyText = useCallback((s: Strategy): string => {
    switch (s.id) {
      case 'winter-ops': return t.stratWinter({ lines: String(s.params.lines), precip: String(s.params.precip) })
      case 'storm-advisory': return t.stratStorm({ lines: String(s.params.lines), wind: Number(s.params.wind) })
      case 'congestion-relief': return t.stratCongestion({ lines: String(s.params.lines), load: Number(s.params.load), delay: Number(s.params.delay) })
      case 'shuttle-bridge': return t.stratShuttle({ corridor: String(s.params.corridor) })
      case 'thermal-points': return t.stratThermal({ kind: String(s.params.kind) })
      case 'story-call': return t.stratStoryCall({ cell: String(s.params.cell) })
      case 'story-gap': return t.stratStoryGap({ count: Number(s.params.count) })
    }
  }, [t])

  const strategyHorizon = useCallback((h: Strategy['horizon']): string => {
    switch (h) {
      case 'today': return t.horizonToday
      case 'days': return t.horizonDays
      default: return t.horizonNow
    }
  }, [t])

  /* The developer docs follow the UI language (both sets are published). */
  const devDocs = ui === 'en' ? '/developer/en' : '/developer'

  /* Publish readiness — visible to the author before pressing submit. */
  const narrativeOk = narrative.trim().length >= 16
  const functionalOk = functional.trim().length >= 8

  const signalMeter = (signal: CityStory['signal']) => (
    <span className="clt-meter-wrap" title={`${t.fictionLabel} ${signal.fiction} · ${t.factsLabel} ${signal.facts} · R ${signal.realityIndex}`}>
      <span className="clt-meter-labels">
        <span>{t.fictionLabel} {signal.fiction}</span>
        <span>R {signal.realityIndex}</span>
        <span>{t.factsLabel} {signal.facts}</span>
      </span>
      <span className="clt-meter">
        <span className="clt-meter-fiction" style={{ width: `${100 - signal.realityIndex}%` }} />
        <span className="clt-meter-facts" style={{ width: `${signal.realityIndex}%` }} />
      </span>
    </span>
  )

  const authorLine = (story: CityStory) => (
    <span className="clt-wall-id">
      {story.display_name ?? `${t.anonymous}: ${story.author_pseudonym.slice(0, 10)}…`}
    </span>
  )

  return (
    <div className="clt-shell">
      <aside className="clt-rail" data-testid="settings-rail">
        <div className="clt-rail-brand">
          <span className="clt-brand">MUSI—CO</span>
          <span className="clt-rail-app">CITY-LIFE-TELLING</span>
        </div>

        <div className="clt-rail-section">
          <span className="clt-media-label">{t.modeLabel}</span>
          <div className="clt-rail-modes" role="group" aria-label={t.modeLabel}>
            <button data-testid="mode-citizen" aria-pressed={mode === 'citizen'}
              className={mode === 'citizen' ? 'on' : ''}
              onClick={() => switchMode('citizen')}>
              <b>Citizens</b><i>Users</i>
            </button>
            <button data-testid="mode-strategist" aria-pressed={mode === 'strategist'}
              className={`strategist${mode === 'strategist' ? ' on' : ''}`}
              onClick={() => switchMode('strategist')}>
              <b>Urban Strategist</b><i>developer</i>
            </button>
          </div>
        </div>

        <div className="clt-rail-section">
          <span className="clt-media-label">{t.langLabel}</span>
          <div className="clt-rail-modes" role="group" aria-label={t.langLabel}>
            {(['it', 'en'] as UiLang[]).map((l) => (
              <button key={l} className={ui === l ? 'on' : ''} onClick={() => switchUi(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <p className="clt-rail-note">{t.privacy}</p>
      </aside>

      <main className="clt-body">
        <header className="clt-head">
          <h1>{t.title}</h1>
          <p className="clt-lede">{t.subtitle}</p>
          {mode === 'strategist' && <p className="clt-hint clt-strategy-hint">{t.strategistNote}</p>}
        </header>

        <section className="clt-card clt-hero">
          <h2>{t.mapTitle}</h2>
          <div ref={mapDiv} className="clt-map" />
          <div className="clt-legend">
            <span className="clt-media-label">{t.storyLegend}</span>
            {(['saturated-fiction', 'narrative-leaning', 'balanced', 'fact-leaning', 'saturated-facts'] as const).map((band) => (
              <span key={band} className="clt-legend-item">
                <i style={{ background: BAND_COLOR[band] }} />
                {bandWord(t, band)}
              </span>
            ))}
          </div>
          <p className="clt-hint">{t.mapHint}</p>
        </section>

        {mode === 'strategist' && (
          <section className="clt-card clt-wide" data-testid="matsim-console">
            <h2>{t.sourceTitle}</h2>
            <p className="clt-hint">{t.contractNote}</p>
            <div className="clt-chips">
              <button className={`clt-chip${prefs.kind === 'simulated' ? ' on' : ''}`}
                onClick={() => setPrefs((prev) => ({ ...prev, kind: 'simulated' }))}>{t.sourceSimulated}</button>
              <button className={`clt-chip${prefs.kind === 'http' ? ' on' : ''}`}
                onClick={() => setPrefs((prev) => ({ ...prev, kind: 'http' }))}>{t.sourceHttp}</button>
              <button className={`clt-chip${paused ? ' on' : ''}`} onClick={() => setPaused((p) => !p)}>
                {paused ? t.resume : t.pause}
              </button>
            </div>
            {prefs.kind === 'http' ? (
              <div className="clt-row">
                <label className="clt-edge-label">{t.sourceUrl}
                  <input className="clt-edge" value={urlDraft} placeholder="https://…/matsim/snapshot.json"
                    onChange={(e) => setUrlDraft(e.target.value)} />
                </label>
                <button className="clt-chip" onClick={applySource}>{t.applySource}</button>
              </div>
            ) : (
              <div className="clt-row">
                <label>{t.seed}
                  <input className="clt-edge" inputMode="numeric" value={seedDraft}
                    onChange={(e) => setSeedDraft(e.target.value)} />
                </label>
                <button className="clt-chip" onClick={applySource}>{t.applySource}</button>
              </div>
            )}
            <h3>{t.weatherTitle}</h3>
            <p className="clt-hint">{t.weatherNote}</p>
            <div className="clt-row">
              <label className="clt-edge-label">{t.weatherHttp}
                <input className="clt-edge" value={weatherUrlDraft} placeholder="https://…/weather.json"
                  onChange={(e) => setWeatherUrlDraft(e.target.value)} />
              </label>
              <button className="clt-chip" onClick={applySource}>{t.applySource}</button>
            </div>
            {feedError && <p className="clt-error">{t.feedError}: {feedError}</p>}
            {calibrated && (
              <pre className="clt-json" data-testid="snapshot-json">{JSON.stringify(calibrated, null, 2)}</pre>
            )}
            {kpis && (
              <div className="clt-kpis" data-testid="kpis">
                <span><b>{kpis.onboard}</b> {t.kpiOnboard}</span>
                <span><b>{kpis.waiting}</b> {t.kpiWaiting}</span>
                <span><b>{kpis.avgTripMin}m</b> {t.kpiAvgTrip}</span>
                <span><b>{kpis.avgDelay}s</b> {t.kpiAvgDelay}</span>
                <span><b>{kpis.disrupted}</b> {t.kpiDisrupted}</span>
                <span><b>{kpis.load}%</b> {t.kpiLoad}</span>
              </div>
            )}
            <h3>{t.consoleMapTitle}</h3>
            <div className="clt-chips" data-testid="console-scope">
              {(['focus', 'city'] as const).map((scope) => (
                <button key={scope} data-testid={`console-scope-${scope}`}
                  className={`clt-chip${calibration.scope === scope ? ' on' : ''}`}
                  onClick={() => setCalibration((prev) => ({
                    ...prev,
                    scope,
                    agentBudget: scope === 'focus' ? Math.min(prev.agentBudget, AGENT_BUDGET_MAX) : prev.agentBudget,
                  }))}>
                  {scope === 'city' ? t.scopeCity : t.scopeFocus}
                </button>
              ))}
              <span className="clt-media-label">{calibration.scope === 'city' ? t.cityNote : t.calibZoneNote}</span>
            </div>
            <AgentConsole agents={agents} focus={calibration.focus} density={density}
              scope={calibration.scope}
              tick={calibrated?.tick ?? 0} budget={calibration.agentBudget}
              ariaLabel={t.consoleMapAria} tickLabel={t.live}
              scopeLabel={calibration.scope === 'city' ? t.scopeCity : t.scopeFocus} />
            <div className="clt-legend">
              <span className="clt-media-label">{t.legend}</span>
              {(['nominal', 'irregular', 'delayed', 'disrupted', 'suspended'] as ServiceStatus[]).map((status) => (
                <span key={status} className="clt-legend-item">
                  <i style={{ background: STATUS_COLOR[status] ?? '#2f9e44' }} />
                  {statusWord(t, status)}
                </span>
              ))}
            </div>
            <div className="clt-row">
              <button className="clt-chip" onClick={exportJson}>{t.exportBtn}</button>
            </div>
          </section>
        )}

        {mode === 'strategist' && (
          <section className="clt-card clt-wide" data-testid="signal-analytics">
            <h2>{t.analyticsTitle}</h2>
            <p className="clt-media-label">{t.histTitle}</p>
            <div className="clt-hist">
              {histogram.map((count, i) => (
                <div key={i} className="clt-hist-col">
                  <span className="clt-hist-bar" style={{ height: `${Math.min(100, count * 12)}px` }} />
                  <span className="clt-hist-label">{i * 20}–{i * 20 + 20}</span>
                  <span className="clt-hist-count">{count}</span>
                </div>
              ))}
            </div>
            <div className="clt-verdicts">
              {Object.entries(verdictCounts).map(([verdict, count]) => (
                <span key={verdict} className={`clt-verdict-chip ${verdict}`}>{verdictShort(verdict as AvaVerdict)}: {count}</span>
              ))}
            </div>
            <h3>{t.crossTitle}</h3>
            {crossRows.length === 0 && <p className="clt-hint">{t.crossEmpty}</p>}
            <ul className="clt-cross">
              {crossRows.map(({ story, live }) => (
                <li key={story.id}>
                  <span className="clt-wall-id">{story.id}</span>
                  {live.correlations.map((c, i) => (
                    <span key={i} className="clt-wall-mood">
                      {c.lineLabel} → {claimWord(t, c.claim.kind)} · {verdictShort(c.verdict)}
                    </span>
                  ))}
                  <span className="clt-wall-id">{t.avaDataValue}: {live.dataValue}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {mode === 'strategist' && (
        <section className="clt-card clt-wide" data-testid="developer-guide">
          <h2>{t.devTitle}</h2>
          <p className="clt-hint">{t.devIntro}</p>
          <h3>{t.devQuick}</h3>
          <pre className="clt-json">{`npm run bridge\nnpm run bridge:sim\nnode matsim-bridge/verify.mjs http://localhost:8787\nCLT_STANDALONE=1 npm run build`}</pre>
          <h3>{t.devContractTitle}</h3>
          <p className="clt-hint">{t.devContractHint}</p>
          <h3>{t.devDocs}</h3>
          <div className="clt-chips">
            <a className="clt-action" href={`${devDocs}/README.md`} target="_blank" rel="noreferrer">{t.devDocUsage}</a>
            <a className="clt-action" href={`${devDocs}/MATSIM_BRIDGE.md`} target="_blank" rel="noreferrer">{t.devDocBridge}</a>
            <a className="clt-action" href={`${devDocs}/RESEARCH_TEST_PROTOCOL.md`} target="_blank" rel="noreferrer">{t.devDocProtocol}</a>
            <a className="clt-action" href={`${devDocs}/AGENT_SPEC.md`} target="_blank" rel="noreferrer">{t.devDocSpec}</a>
            <a className="clt-action" href={`${devDocs}/STORYTELLING_PROTOCOL.md`} target="_blank" rel="noreferrer">{t.devDocStorytelling}</a>
          </div>
          <p className="clt-hint">{t.devKeyHint}</p>
        </section>
      )}

      {mode === 'strategist' && (
        <section className="clt-card clt-wide" data-testid="calibration">
          <h2>{t.calibTitle}</h2>
          <p className="clt-hint">{t.calibIntro}</p>
          <h3>{t.calibFrame}</h3>
          <div className="clt-chips">
            {(['hour', 'day', 'week', 'month'] as ClockKey[]).map((key) => (
              <button key={key} className={`clt-chip${calibration.emphasis === key ? ' on' : ''}`}
                onClick={() => setFrame(key)}>
                {key === 'hour' ? t.frameHour : key === 'day' ? t.frameDay : key === 'week' ? t.frameWeek : t.frameMonth}
              </button>
            ))}
            <button className={`clt-chip${calibration.emphasis === 'custom' ? ' on' : ''}`}
              onClick={() => setCalibration((prev) => ({ ...prev, emphasis: 'custom' }))}>{t.frameCustom}</button>
          </div>
          <div className="clt-calib-grid">
            {rangeRow(t.calibDemand, calibration.demand, `${calibration.demand.toFixed(1)}×`, 0.2, 3, 0.1,
              (v) => setCalibration((prev) => ({ ...prev, demand: v })))}
            {rangeRow(t.calibClockHour, calibration.clocks.hour, `${calibration.clocks.hour.toFixed(1)}`, 0, 2, 0.1,
              (v) => setClock('hour', v))}
            {rangeRow(t.calibClockDay, calibration.clocks.day, `${calibration.clocks.day.toFixed(1)}`, 0, 2, 0.1,
              (v) => setClock('day', v))}
            {rangeRow(t.calibClockWeek, calibration.clocks.week, `${calibration.clocks.week.toFixed(1)}`, 0, 2, 0.1,
              (v) => setClock('week', v))}
            {rangeRow(t.calibClockMonth, calibration.clocks.month, `${calibration.clocks.month.toFixed(1)}`, 0, 2, 0.1,
              (v) => setClock('month', v))}
            {rangeRow(t.calibCongestion, calibration.congestionSensitivity, `${calibration.congestionSensitivity.toFixed(1)}×`, 0.2, 2, 0.1,
              (v) => setCalibration((prev) => ({ ...prev, congestionSensitivity: v })))}
            {calibration.scope === 'focus' && rangeRow(t.calibRadius, calibration.focus.radiusKm, `${calibration.focus.radiusKm.toFixed(1)} km`, 0.5, 5, 0.5,
              (v) => setCalibration((prev) => ({ ...prev, focus: { ...prev.focus, radiusKm: v } })))}
            {rangeRow(t.calibBudget, calibration.agentBudget, `${calibration.agentBudget}`,
              AGENT_BUDGET_MIN, calibration.scope === 'city' ? CITY_AGENT_BUDGET_MAX : AGENT_BUDGET_MAX, 8,
              (v) => setCalibration((prev) => ({ ...prev, agentBudget: Math.round(v) })))}
          </div>
          <div className="clt-weather" data-testid="clock-breakdown">
            <span className="clt-weather-chip">{t.frameHour} ×{breakdown.hour}</span>
            <span className="clt-weather-chip">{t.frameDay} ×{breakdown.day}</span>
            <span className="clt-weather-chip">{t.frameWeek} ×{breakdown.week}</span>
            <span className="clt-weather-chip">{t.frameMonth} ×{breakdown.month}</span>
            <span className="clt-weather-chip"><b>{t.calibEffective} ×{breakdown.effective}</b></span>
            <span className="clt-weather-chip">{t.calibAgents} {agents.length}/{calibration.agentBudget}</span>
          </div>
          <h3>{t.calibScope}</h3>
          <div className="clt-chips">
            {(['focus', 'city'] as const).map((scope) => (
              <button key={scope} className={`clt-chip${calibration.scope === scope ? ' on' : ''}`}
                onClick={() => setCalibration((prev) => ({
                  ...prev,
                  scope,
                  agentBudget: scope === 'focus' ? Math.min(prev.agentBudget, AGENT_BUDGET_MAX) : prev.agentBudget,
                }))}>
                {scope === 'city' ? t.scopeCity : t.scopeFocus}
              </button>
            ))}
          </div>
          <p className="clt-hint">{calibration.scope === 'city' ? t.cityNote : t.calibZoneNote}</p>
          {calibration.scope === 'focus' && (
            <>
          <h3>{t.calibFocus}</h3>
          <div className="clt-chips">
            {FOCUS_PRESETS.map((focus) => (
              <button key={focus.id} className={`clt-chip${calibration.focus.id === focus.id ? ' on' : ''}`}
                onClick={() => setCalibration((prev) => ({ ...prev, focus: { ...focus } }))}>{focus.label}</button>
            ))}
            <button className="clt-chip" onClick={() => setCalibration({ ...DEFAULT_CALIBRATION })}>{t.calibReset}</button>
          </div>
            </>
          )}
          {calibration.scope === 'city' && (
            <div className="clt-chips">
              <button className="clt-chip" onClick={() => setCalibration({ ...DEFAULT_CALIBRATION })}>{t.calibReset}</button>
            </div>
          )}
        </section>
      )}

      <section className="clt-grid">
          <div className="clt-col">
            {mode === 'citizen' && (
              <div className="clt-card" data-testid="composer">
                <h2>{t.composerTitle}</h2>
                <h3>{t.simPromptsTitle}</h3>
                <p className="clt-hint">{t.simPromptsHint}</p>
                <div className="clt-chips" data-testid="sim-prompts">
                  {prompts.length === 0 && <span className="clt-hint">{t.noSimPrompts}</span>}
                  {prompts.map((prompt) => (
                    <button key={prompt.id} className={`clt-chip${promptRef?.id === prompt.id ? ' on' : ''}`}
                      onClick={() => useSimPrompt(prompt)}>
                      {prompt.lineLabel} · {statusWord(t, prompt.simStatus)} · {prompt.simDelaySec}s
                    </button>
                  ))}
                </div>
                <div className="clt-presets">
                  {PRESETS.map((preset) => (
                    <button key={preset.label} className="clt-chip" onClick={() => pickPreset(preset)}>{preset.label}</button>
                  ))}
                </div>
              <label className="clt-channel">
                <span className="clt-channel-head">
                  <b>{t.channelFictional}</b>
                  <i className={`clt-counter${narrativeOk ? ' ok' : ''}`}>{t.counter(narrative.length, MAX_FICTIONAL)}</i>
                </span>
                <textarea className="clt-text" value={narrative} rows={4} maxLength={MAX_FICTIONAL} placeholder={t.channelFictionalPh}
                  onChange={(e) => setNarrative(e.target.value)} />
              </label>
              <label className="clt-channel">
                <span className="clt-channel-head">
                  <b>{t.channelFunctional}</b>
                  <i className={`clt-counter${functionalOk ? ' ok' : ''}`}>{t.counter(functional.length, MAX_FUNCTIONAL)}</i>
                </span>
                <textarea className="clt-text" value={functional} rows={3} maxLength={MAX_FUNCTIONAL} placeholder={t.channelFunctionalPh}
                  onChange={(e) => setFunctional(e.target.value)} />
              </label>
                <div className="clt-row">
                  <label>{t.nameField}
                    <input className="clt-edge" value={displayName} placeholder="Jane D. / Giulia R. / …"
                      onChange={(e) => setDisplayName(e.target.value)} />
                  </label>
                </div>
                <p className="clt-hint">{t.nameHint}</p>
                <div className="clt-row">
                  <label>{t.storyLang}
                    <select value={lang} onChange={(e) => setLang(e.target.value)}>
                      <option value="fr">fr</option><option value="en">en</option><option value="it">it</option>
                    </select>
                  </label>
                  <label>{t.lineHint}
                    <select value={forcedLine} onChange={(e) => setForcedLine(e.target.value)}>
                      <option value="auto">{t.lineAuto}</option>
                      {SEED_LINES.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}
                    </select>
                  </label>
                </div>
                <h3>{t.mediaBtn}</h3>
                <input ref={fileInput} type="file" multiple hidden
                  accept="image/*,video/*,audio/*,.txt,.md,.csv"
                  onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }} />
                <div className="clt-chips">
                  <button className="clt-chip" onClick={() => fileInput.current?.click()}>{t.mediaBtn}</button>
                  {pendingFiles.length > 0 && (
                    <span className="clt-media-label">{(totalSize(pendingFiles) / 1024 / 1024).toFixed(2)} / 10 MB</span>
                  )}
                </div>
                {pendingFiles.length > 0 && (
                  <ul className="clt-files">
                    {pendingFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`}>
                        <span className="clt-wall-mood">{file.type || file.name} · {(file.size / 1024).toFixed(0)} kB</span>
                        <button className="clt-chip" onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== index))}>{t.remove}</button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="clt-hint">{t.mediaHint}</p>
                <h3>{t.consentTitle}</h3>
                <div className="clt-consent">
                  <label className={geoMode === 'grid' ? 'on' : ''}>
                    <input type="radio" name="geo" checked={geoMode === 'grid'} onChange={() => setGeoMode('grid')} />
                    <span><b>{t.consentGrid}</b> — {t.consentGridHint}</span>
                  </label>
                  <label className={geoMode === 'none' ? 'on' : ''}>
                    <input type="radio" name="geo" checked={geoMode === 'none'} onChange={() => setGeoMode('none')} />
                    <span><b>{t.consentNone}</b> — {t.consentNoneHint}</span>
                  </label>
                </div>
                <p className="clt-hint">{t.localPoint(point)}</p>
                <div className="clt-row">
                  <button className="clt-submit" disabled={busy || !narrativeOk || !functionalOk || totalSize(pendingFiles) > MEDIA_TOTAL_BUDGET} onClick={publish}>
                    {busy ? t.submitting : t.submit}
                  </button>
                </div>
                {!busy && (!narrativeOk || !functionalOk) && (
                  <p className="clt-hint clt-missing" data-testid="publish-blocked">
                    {[!narrativeOk ? t.errorNarrative(narrative.trim().length) : null,
                      !functionalOk ? t.errorFunctional(functional.trim().length) : null].filter(Boolean).join(' · ')}
                  </p>
                )}
                {error && <p className="clt-error" data-testid="publish-error">{error}</p>}
                {notice && <p className="clt-notice">{notice}</p>}
              </div>
            )}

            <div className="clt-card" data-testid="ava-panel">
              {!avaOpen ? (
                <>
                  <h2>🔒 {t.avaLockedTitle}</h2>
                  <p className="clt-hint">{t.avaLockedHint}</p>
                  <div className="clt-row">
                    <label>{t.avaKeyLabel}
                      <input className="clt-edge" value={keyDraft} placeholder={t.avaKeyPh}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') unlockAva() }} />
                    </label>
                    <button className="clt-submit" onClick={unlockAva}>{t.avaUnlock}</button>
                  </div>
                  {keyError && <p className="clt-error">{t.avaKeyInvalid}</p>}
                </>
              ) : (
                <>
                  <h2>{t.avaTitle}{reading && <span className="clt-media-label"> · {t.avaDataValue} {reading.dataValue}</span>}</h2>
                  <p className="clt-notice">{t.avaKeyUnlocked}</p>
                  {!reading && <p className="clt-hint">{t.avaIdle}</p>}
                  {reading && selectedStory && (
                    <div className="clt-ava">
                      {reading.parts.map((part, index) => renderPart(part, index))}
                      {mode === 'strategist' && (
                        <p className="clt-wall-id">{t.avaFactors}: {reading.factors.join(' · ')}</p>
                      )}
                    </div>
                  )}

                  {mode === 'strategist' && (
                    <>
                      <h3>{t.weatherTitle}</h3>
                      {forecast && (
                        <div className="clt-weather" data-testid="weather-chips">
                          {forecast.periods.map((p, i) => (
                            <span key={i} className="clt-weather-chip">
                              <b>{weatherPeriodWord(t, p.id)}</b> · {t.weatherTemp(p.tempC)} · {precipWord(t, p.precipKind)}
                              {p.precipMm > 0 ? ` ${p.precipMm}mm` : ''} · {t.weatherWind(p.windKmh)} · {alertWord(t, p.alert)}
                            </span>
                          ))}
                          <span className="clt-weather-chip">stress {forecastStress(forecast).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="clt-row">
                        <button className="clt-submit" data-testid="ask-strategies" onClick={askStrategies}>{t.askAva}</button>
                      </div>
                      {strategies && (
                        <div className="clt-strategies" data-testid="strategies">
                          <p className="clt-media-label">{t.strategiesTitle} · {t.strategyPriority} ↓</p>
                          {strategies.map((s, i) => (
                            <div key={s.id} className="clt-strategy">
                              <div className="clt-strategy-top">
                                <span className="clt-strategy-rank">#{i + 1}</span>
                                <span className="clt-strategy-title">{strategyText(s)}</span>
                                <span className="clt-strategy-score">{t.strategyPriority} {s.score} · {strategyHorizon(s.horizon)}</span>
                              </div>
                              {s.targetLines.length > 0 && (
                                <p className="clt-wall-mood">{s.targetLines.map((id) => lineLabelOf(id)).join(' · ')}</p>
                              )}
                              <p className="clt-factors">{t.avaFactors}: {s.factors.join(' · ')}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="clt-col">
            <div className="clt-card" data-testid="wall">
              <h2>{t.wallTitle} ({filtered.length})</h2>
              <div className="clt-chips">
                {(['all', 'balanced', 'facts', 'fiction'] as Filter[]).map((f) => (
                  <button key={f} className={`clt-chip${filter === f ? ' on' : ''}`}
                    onClick={() => setFilter(f)}>
                    {f === 'all' ? t.filterAll : f === 'balanced' ? t.filterBalanced : f === 'facts' ? t.filterFacts : t.filterFiction}
                  </button>
                ))}
              </div>
              {filtered.length === 0 && <p className="clt-hint">{t.wallEmpty}</p>}
              <ul className="clt-wall">
                {filtered.map((story) => (
                  <li key={story.id} className={selected === story.id ? 'sel' : ''} onClick={() => setSelected(story.id)}>
                    <div className="clt-wall-top">
                      <span className="clt-wall-dim" style={{ background: BAND_COLOR[story.signal.band] }}>
                        {bandWord(t, story.signal.band)}
                      </span>
                      <span className={`clt-verdict-chip ${story.ava.verdict}`}>{verdictShort(story.ava.verdict)}</span>
                      <span className="clt-wall-id">{story.id.slice(0, 11)}</span>
                      {story.origin === 'echo' && <span className="clt-wall-mood">{t.sharedBadge}</span>}
                      {mine.has(story.id) && <span className="clt-wall-mood">{t.mineBadge}</span>}
                      {story.prompt_ref && <span className="clt-wall-mood">{t.simPromptBadge}</span>}
                      {story.echoes > 0 && <span className="clt-wall-mood">{t.echoesLabel(story.echoes)}</span>}
                      <span className="clt-wall-id">{t.avaDataValue} {story.ava.dataValue}</span>
                    </div>
                    <div className="clt-wall-author">
                      {authorLine(story)}
                      <span className="clt-wall-mood">{new Date(story.ts).toLocaleString()}</span>
                      <span className="clt-wall-mood">{story.geo ? story.geo.index : '—'}</span>
                    </div>
                    {signalMeter(story.signal)}
                    <p className="clt-wall-text">{story.narrative}</p>
                    <p className="clt-wall-functional">{story.functional}</p>
                    <StoryMedia media={story.media ?? []} />
                    <div className="clt-row clt-tight" onClick={(e) => e.stopPropagation()}>
                      <button className="clt-action" onClick={() => echo(story.id)}>{t.echo} ▸</button>
                      <button className="clt-action" onClick={() => void share(story)}>↗ {t.shareBtn}</button>
                      <button className="clt-action" onClick={() => copyLink(story)}>{t.copyLink}</button>
                      {mode === 'citizen' && <button className="clt-action" onClick={() => reply(story)}>{t.reply}</button>}
                      {(mode === 'strategist' || mine.has(story.id)) && (
                        <button className="clt-action clt-delete" data-testid={`delete-${story.id}`} onClick={() => remove(story)}>{t.deleteStory} ✕</button>
                      )}
                    </div>
                    <div className="clt-row clt-social" onClick={(e) => e.stopPropagation()}>
                      <span className="clt-media-label">{t.socialTitle}</span>
                      <button className="clt-action clt-social-x" onClick={() => social(story, 'x')}>X</button>
                      <button className="clt-action clt-social-fb" onClick={() => social(story, 'facebook')}>Facebook</button>
                      <button className="clt-action clt-social-ig" onClick={() => social(story, 'instagram')}>Instagram</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <footer className="clt-foot">
          <span>{t.privacy}</span>
          <span>{t.footRight}</span>
        </footer>
      </main>
    </div>
  )
}
