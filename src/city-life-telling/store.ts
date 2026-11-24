/** CITY-LIFE-TELLING — story store, publish pipeline and share codec.
 *
 *  Local-first by design: stories live in `localStorage` under an opaque
 *  id, never leave the consent gate with exact coordinates, and travel
 *  only inside share links that carry the anonymised grid cell. The publish
 *  pipeline reuses the Assistive Urban Storytelling gates (consent → PII
 *  scrub → deg-grid obfuscation) and adds the two City-Life-Telling
 *  channels plus the fiction⇄facts measurement and AVA's first reading.
 *
 *  When the Polytechnique Montréal coupling and a shared backend are
 *  defined, `publishCityStory` is the seam to swap with a server call —
 *  the UI depends only on the `CityStory` contract. */

import { validateConsent } from '../assist-urban/pipeline/consent.js'
import { obfuscatePoint, pseudonym, scrubText, textHash } from '../assist-urban/pipeline/pii.js'
import { maybeEmitForStory } from './ava_record/persist.ts'
import { detectClaims, inferClaimKind, avaRead, type AvaReading, type StoryClaim } from './ava-agent.js'
import { isValidKey } from './ava-key.js'
import type { ClMediaRef } from './media-db.js'
import type { MatsimSnapshot } from './matsim/types.js'
import type { PromptRef } from './prompts.js'
import { analyzeStory, type StorySignal } from './signal.js'

export const STORIES_KEY = 'city-life-telling.stories.v1'
export const MODE_KEY = 'city-life-telling.mode.v1'
export const SOURCE_KEY = 'city-life-telling.matsim-source.v1'
export const MAX_STORIES = 240

export type AppMode = 'citizen' | 'strategist'

export interface CityStory {
  id: string
  /** Chosen display name when the author decides to sign; else anonymous. */
  display_name: string | null
  author_pseudonym: string
  narrative: string
  functional: string
  text_hash: string
  lang: string
  ts: string
  /** Anonymous grid cell only — exact coordinates never published. */
  geo: { index: string, res: number } | null
  /** Local media (IndexedDB, opaque ids, ≤ 10 MB per story). */
  media: ClMediaRef[]
  signal: StorySignal
  claims: StoryClaim[]
  /** AVA's reading at publish time, compact; parts are recomputed on demand. */
  ava: { verdict: AvaReading['verdict'], verdictScore: number, dataValue: number }
  echoes: number
  origin: 'local' | 'echo'
  scrubbed_terms: number
  /** The MATSim snapshot the story was judged against at publish time. */
  snapshot_ref: SnapshotRef | null
  /** The simulation prompt that elicited the story, if any (research). */
  prompt_ref: PromptRef | null
}

export interface SnapshotRef {
  contract: string
  scenario: string
  tick: number
  generatedAt: string
}

export interface PublishInput {
  narrative: string
  functional: string
  lang?: string
  lat?: number | null
  lon?: number | null
  geo_resolution?: number
  /** Force a line claim when the text does not name one explicitly. */
  forced_line?: string | null
  /** Optional signature chosen by the author (empty ⇒ anonymous). */
  display_name?: string | null
  /** Local media references (already stored under opaque ids). */
  media?: ClMediaRef[]
  /** The simulation prompt that elicited the story, if any. */
  prompt_ref?: PromptRef | null
}

export interface PublishConsent {
  geo_mode: 'grid' | 'none'
  allow_dispatch: boolean
}

export type PublishError = 'narrative_required' | 'functional_required' | 'consent' | 'coordinates'

const MIN_NARRATIVE = 16
const MIN_FUNCTIONAL = 8
/** Channel caps (editor enforces them too): fictional 1000, functional 500. */
export const MAX_FICTIONAL = 1000
export const MAX_FUNCTIONAL = 500

export function validateInput(input: PublishInput): PublishError | null {
  if (typeof input.narrative !== 'string' || input.narrative.trim().length < MIN_NARRATIVE) return 'narrative_required'
  if (typeof input.functional !== 'string' || input.functional.trim().length < MIN_FUNCTIONAL) return 'functional_required'
  return null
}

function randomHex(n: number): string {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Full pipeline: validate → consent gate → scrub → grid → measure → AVA. */
export async function publishCityStory(
  input: PublishInput,
  consent: PublishConsent,
  snapshot: MatsimSnapshot | null,
): Promise<CityStory> {
  const invalid = validateInput(input)
  if (invalid) throw new Error(invalid)

  const hasCoords = typeof input.lat === 'number' && typeof input.lon === 'number'
  let decision: ReturnType<typeof validateConsent>
  try {
    decision = validateConsent(hasCoords, { ...consent, geo_mode: consent.geo_mode === 'grid' ? 'grid' : 'none' })
  } catch {
    throw new Error('coordinates')
  }
  if (!decision.accepted) throw new Error('consent')

  const narrative = scrubText(input.narrative.trim().slice(0, MAX_FICTIONAL))
  const functional = scrubText(input.functional.trim().slice(0, MAX_FUNCTIONAL))
  const displayName = typeof input.display_name === 'string' && input.display_name.trim().length > 0
    ? scrubText(input.display_name.trim().slice(0, 40))
    : null
  const scrubbed_terms = narrative.removed + functional.removed + (displayName?.removed ?? 0)
  const media = Array.isArray(input.media)
    ? input.media
      .filter((m) => m && typeof m.id === 'string' && /^md_[a-f0-9]{16}$/.test(m.id)
        && ['image', 'video', 'audio', 'text'].includes(String(m.kind))
        && Number.isFinite(m.size) && m.size >= 0 && m.size <= 10 * 1024 * 1024)
      .slice(0, 8)
      .map((m) => ({ id: m.id, kind: m.kind, size: m.size }))
    : []
  const mediaTotal = media.reduce((n, m) => n + m.size, 0)
  if (mediaTotal > 10 * 1024 * 1024) throw new Error('media budget exceeded (10 MB)')

  const id = 'st_' + randomHex(8)
  const lang = ['en', 'fr', 'it'].includes(input.lang ?? '') ? input.lang! : 'en'
  const geo = decision.geoModeDispatch === 'grid' && hasCoords
    ? (() => {
        const ob = obfuscatePoint(input.lat!, input.lon!, input.geo_resolution ?? 8)
        return { index: ob.index, res: input.geo_resolution ?? 8 }
      })()
    : null

  const signal = analyzeStory({ narrative: narrative.text, functional: functional.text })
  const corpus = `${functional.text}\n${narrative.text}`
  const claims = detectClaims(corpus)
  if (input.forced_line && !claims.some((c) => c.lineId === input.forced_line)) {
    claims.push({ lineId: input.forced_line, kind: inferClaimKind(corpus) })
  }
  const reading = avaRead({ narrative: narrative.text, functional: functional.text }, snapshot, geo?.index ?? null, signal)
  const snapshotRef: SnapshotRef | null = snapshot
    ? { contract: snapshot.contract, scenario: snapshot.scenario, tick: snapshot.tick, generatedAt: snapshot.generatedAt }
    : null
  const promptRef: PromptRef | null = input.prompt_ref
    && input.prompt_ref.source === 'simulation'
    && typeof input.prompt_ref.lineId === 'string'
    && Number.isFinite(input.prompt_ref.tick)
    ? {
        source: 'simulation',
        lineId: input.prompt_ref.lineId.slice(0, 40),
        tick: Math.max(0, Math.floor(input.prompt_ref.tick)),
        simStatus: input.prompt_ref.simStatus,
      }
    : null

  const story: CityStory = {
    id,
    display_name: displayName?.text ?? null,
    author_pseudonym: await pseudonym(id),
    narrative: narrative.text,
    functional: functional.text,
    text_hash: await textHash(narrative.text + '|' + functional.text),
    lang,
    ts: new Date().toISOString(),
    geo,
    media,
    signal,
    claims,
    ava: { verdict: reading.verdict, verdictScore: reading.verdictScore, dataValue: reading.dataValue },
    echoes: 0,
    origin: 'local',
    scrubbed_terms,
    snapshot_ref: snapshotRef,
    prompt_ref: promptRef,
  }
  // Additive AVA Story Record emission: only when the local flag
  // `city-life-telling.ava-record-emit.v1` is 'on'; never throws, no
  // effect on the visible flow (ava_record/persist.ts).
  maybeEmitForStory(story)
  return story
}

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>

export function loadStories(storage: ReadStorage | null | undefined): CityStory[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORIES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is CityStory => {
      if (!s || typeof s !== 'object') return false
      const st = s as Partial<CityStory>
      if (typeof st.id !== 'string'
        || typeof st.narrative !== 'string'
        || typeof st.functional !== 'string'
        || typeof st.author_pseudonym !== 'string'
        || !st.signal || typeof st.signal.realityIndex !== 'number'
        || (st.geo !== null && (typeof st.geo !== 'object' || typeof st.geo.index !== 'string'))) return false
      st.display_name = typeof st.display_name === 'string' ? st.display_name : null
      st.media = Array.isArray(st.media)
        ? st.media.filter((m): m is ClMediaRef => !!m && typeof m.id === 'string'
          && ['image', 'video', 'audio', 'text'].includes(String(m.kind)) && Number.isFinite(m.size))
        : []
      const ref = st.snapshot_ref as SnapshotRef | null | undefined
      st.snapshot_ref = ref && typeof ref.tick === 'number' ? ref : null
      const prompt = st.prompt_ref as PromptRef | null | undefined
      st.prompt_ref = prompt && prompt.source === 'simulation' && typeof prompt.lineId === 'string' ? prompt : null
      return true
    })
  } catch {
    return []
  }
}

export function saveStories(stories: CityStory[], storage: WriteStorage | null | undefined): void {
  if (!storage) return
  try {
    storage.setItem(STORIES_KEY, JSON.stringify(stories.slice(0, MAX_STORIES)))
  } catch {
    // Quota or privacy mode: the session still works, persistence is optional.
  }
}

export function addEcho(id: string, stories: CityStory[]): CityStory[] {
  return stories.map((s) => s.id === id ? { ...s, echoes: s.echoes + 1 } : s)
}

export function deleteStory(id: string, stories: CityStory[]): CityStory[] {
  return stories.filter((s) => s.id !== id)
}

/* ---------------------------------------------------------- authorship */

const MINE_KEY = 'city-life-telling.mine.v1'

/** Ids of stories published from this device — the citizen's "mine" set. */
export function loadMine(storage: ReadStorage | null | undefined): Set<string> {
  try {
    const raw = storage?.getItem(MINE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function markMine(id: string, storage: ReadStorage & Partial<WriteStorage> | null | undefined): void {
  if (!storage || !storage.setItem) return
  try {
    const mine = loadMine(storage)
    mine.add(id)
    storage.setItem(MINE_KEY, JSON.stringify([...mine].slice(-500)))
  } catch {
    // ignore
  }
}

export function unmarkMine(id: string, storage: ReadStorage & Partial<WriteStorage> | null | undefined): void {
  if (!storage || !storage.setItem) return
  try {
    const mine = loadMine(storage)
    mine.delete(id)
    storage.setItem(MINE_KEY, JSON.stringify([...mine]))
  } catch {
    // ignore
  }
}

export function loadMode(storage: ReadStorage | null | undefined): AppMode {
  try {
    return storage?.getItem(MODE_KEY) === 'strategist' ? 'strategist' : 'citizen'
  } catch {
    return 'citizen'
  }
}

export function saveMode(mode: AppMode, storage: WriteStorage | null | undefined): void {
  if (!storage) return
  try {
    storage.setItem(MODE_KEY, mode)
  } catch {
    // ignore
  }
}

export interface SourcePrefs {
  kind: 'simulated' | 'http'
  url: string
  seed: number
  /** Optional weather endpoint (clt.weather.v0); empty ⇒ simulated feed. */
  weatherUrl: string
}

const DEFAULT_PREFS: SourcePrefs = { kind: 'simulated', url: '', seed: 20261105, weatherUrl: '' }

export function loadSourcePrefs(storage: ReadStorage | null | undefined): SourcePrefs {
  try {
    const raw = storage?.getItem(SOURCE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<SourcePrefs>
    return {
      kind: parsed.kind === 'http' ? 'http' : 'simulated',
      url: typeof parsed.url === 'string' ? parsed.url : '',
      seed: typeof parsed.seed === 'number' ? parsed.seed | 0 : DEFAULT_PREFS.seed,
      weatherUrl: typeof parsed.weatherUrl === 'string' ? parsed.weatherUrl : '',
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function saveSourcePrefs(prefs: SourcePrefs, storage: WriteStorage | null | undefined): void {
  if (!storage) return
  try {
    storage.setItem(SOURCE_KEY, JSON.stringify(prefs))
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------ AVA box key */

export const AVA_KEY_STORE = 'city-life-telling.ava-key.v1'

/** The provisional key stored on this device, when still valid. */
export function loadAvaKey(storage: ReadStorage | null | undefined, when: Date = new Date()): string | null {
  try {
    const key = storage?.getItem(AVA_KEY_STORE) ?? null
    return key && isValidKey(key, when) ? key : null
  } catch {
    return null
  }
}

export function saveAvaKey(key: string | null, storage: WriteStorage | null | undefined): void {
  if (!storage) return
  try {
    if (key) storage.setItem(AVA_KEY_STORE, key)
    else storage.removeItem(AVA_KEY_STORE)
  } catch {
    // ignore
  }
}

/* ---------------------------------------------------------------- share */

function b64urlEncode(json: string): string {
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const SHARE_VERSION = 1
interface SharePayload {
  v: number
  id: string
  display_name: string | null
  author_pseudonym: string
  narrative: string
  functional: string
  lang: string
  ts: string
  geo: CityStory['geo']
  signal: { facts: number, fiction: number, realityIndex: number, band: StorySignal['band'] }
  ava: CityStory['ava']
}

/** Compact URL-safe share link carrying the anonymised story itself.
 *  Media never travel in the link: blobs stay on the author's device. */
export function encodeShareHash(story: CityStory): string {
  const payload: SharePayload = {
    v: SHARE_VERSION,
    id: story.id,
    display_name: story.display_name,
    author_pseudonym: story.author_pseudonym,
    narrative: story.narrative.slice(0, MAX_FICTIONAL),
    functional: story.functional.slice(0, MAX_FUNCTIONAL),
    lang: story.lang,
    ts: story.ts,
    geo: story.geo && story.geo.index.startsWith('gr_') ? { index: story.geo.index, res: story.geo.res } : null,
    signal: {
      facts: story.signal.facts, fiction: story.signal.fiction,
      realityIndex: story.signal.realityIndex, band: story.signal.band,
    },
    ava: { verdict: story.ava.verdict, verdictScore: story.ava.verdictScore, dataValue: story.ava.dataValue },
  }
  return b64urlEncode(JSON.stringify(payload))
}

export function decodeShareHash(hash: string): CityStory | null {
  const raw = hash.startsWith('#st=') ? hash.slice(4) : hash.startsWith('st=') ? hash.slice(3) : null
  if (!raw || raw.length > 12000) return null
  try {
    const parsed = JSON.parse(b64urlDecode(raw)) as Partial<SharePayload>
    if (parsed.v !== SHARE_VERSION) return null
    if (typeof parsed.id !== 'string' || typeof parsed.narrative !== 'string' || typeof parsed.functional !== 'string') return null
    if (parsed.geo && (typeof parsed.geo !== 'object' || !parsed.geo.index?.startsWith('gr_'))) return null
    if (!parsed.signal || !parsed.ava) return null
    const signal = analyzeStory({ narrative: parsed.narrative, functional: parsed.functional })
    return {
      id: parsed.id.slice(0, 24),
      display_name: typeof parsed.display_name === 'string' && parsed.display_name.length > 0
        ? parsed.display_name.slice(0, 40)
        : null,
      author_pseudonym: parsed.author_pseudonym?.slice(0, 24) ?? 'anon_shared',
      narrative: parsed.narrative,
      functional: parsed.functional,
      text_hash: 'shared',
      lang: ['en', 'fr', 'it'].includes(parsed.lang ?? '') ? parsed.lang! : 'en',
      ts: typeof parsed.ts === 'string' ? parsed.ts : new Date().toISOString(),
      geo: parsed.geo ? { index: parsed.geo.index.slice(0, 40), res: 8 } : null,
      media: [],
      signal: { ...signal, facts: parsed.signal.facts ?? signal.facts, band: signal.band },
      claims: detectClaims(`${parsed.functional}\n${parsed.narrative}`),
      ava: {
        verdict: parsed.ava.verdict ?? 'unverifiable',
        verdictScore: parsed.ava.verdictScore ?? 0,
        dataValue: parsed.ava.dataValue ?? 0,
      },
      echoes: 0,
      origin: 'echo',
      scrubbed_terms: 0,
      snapshot_ref: null,
      prompt_ref: null,
    }
  } catch {
    return null
  }
}
