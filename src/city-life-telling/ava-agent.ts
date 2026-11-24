/** CITY-LIFE-TELLING — the AVA agent (deterministic core).
 *
 *  AVA reads a geolocated citizen story — dramaturgical channel +
 *  critical-functional channel — and answers by crossing it with the
 *  current MATSim snapshot of Montréal's transit networks. The agent does
 *  three things at once:
 *
 *   1. CORRELATION — extracts verifiable claims from the functional channel
 *      and checks them against the simulated line states (confirm / partial
 *      / diverge / out-of-sim), with an explainable factor trail;
 *   2. DRAMATURGY — reads the narrative channel as theatre, never as noise:
 *      it echoes the dominant motif back to the author;
 *   3. QUALITY DATA — targets the weakest indicators with concrete prompts
 *      (add the time, the line, the place, the numbers), turning storytelling
 *      pressure into better transport observations, and ends with a sharing
 *      push so quality circulates.
 *
 *  The engine is pure and rule-based (no model call): every reply is
 *  reproducible and auditable. UI-side it renders through i18n keys, so the
 *  same reading speaks Italian and English. */

// .ts specifiers: this file is also executed by the ava_record CLI under
// `node --experimental-strip-types`, which does not rewrite .js → .ts.
import { LINE_ALIASES, SEED_LINES } from './matsim/network.ts'
import type { IncidentKind, MatsimSnapshot, ServiceStatus } from './matsim/types.js'
import { analyzeStory, type StoryChannels, type StorySignal } from './signal.ts'

export type ClaimKind = 'delay' | 'cancelled' | 'crowding' | 'closed' | 'mechanical' | 'other'
export type ClaimVerdict = 'confirms' | 'partially' | 'diverges' | 'out-of-sim' | 'unverifiable'
export type AvaVerdict = 'confirms' | 'partially' | 'diverges' | 'unverifiable'

export interface StoryClaim {
  lineId: string
  kind: ClaimKind
}

export interface AvaCorrelation {
  claim: StoryClaim
  lineLabel: string
  simStatus: ServiceStatus
  simDelaySec: number
  simLoad: number
  verdict: ClaimVerdict
  nearKm: number | null
}

export type AvaPartKind =
  | 'verdict'
  | 'correlation'
  | 'dramaturgical'
  | 'quality'
  | 'share'

export interface AvaPart {
  kind: AvaPartKind
  /** i18n key — resolved by the UI strings. */
  key: string
  params?: Record<string, string | number>
}

export interface AvaReading {
  verdict: AvaVerdict
  verdictScore: number
  /** 0..100 — how much usable transport data the story carries. */
  dataValue: number
  correlations: AvaCorrelation[]
  parts: AvaPart[]
  factors: string[]
}

// NOTE: no /g flag — these are used with `.test()`, which is stateful on
// global regexes and would make claim detection depend on call order.
const CLAIM_PATTERNS: Array<{ kind: ClaimKind, re: RegExp }> = [
  { kind: 'delay', re: /\b(in ritardo|ritardo|attesa|attende|en retard|retard|attendent|attente|delayed|delay|late|waiting|wait)\b/i },
  { kind: 'cancelled', re: /\b(annullat[oaie]|soppress[oa]|soppresso|annul[ée]e?s?|supprim[ée]|noShow|no[- ]show|cancelled?|canceled?)\b/i },
  { kind: 'crowding', re: /\b(affollat[oa]|colonn[ae]|coda|bond[ée]|coincé|charg[ée]|crowded|packed|queue|full|jam)\b/i },
  { kind: 'closed', re: /\b(chius[oa]|ferm[ée]|sospes[oa]|suspendu[e?s]?|closed?|shut|suspended)\b/i },
  { kind: 'mechanical', re: /\b(guast[oa]|panne|avaria|bloccat[oa]|bloqu[ée]|breakdown|broke down|failure|stuck|mechanical)\b/i },
]

export function inferClaimKind(text: string): ClaimKind {
  const lower = text.toLowerCase()
  for (const pattern of CLAIM_PATTERNS) {
    if (pattern.re.test(lower)) return pattern.kind
  }
  return 'other'
}

export function detectClaims(text: string): StoryClaim[] {
  const lower = text.toLowerCase()
  const claims: StoryClaim[] = []
  for (const [lineId, aliases] of Object.entries(LINE_ALIASES)) {
    if (!aliases.some((alias) => lower.includes(alias))) continue
    claims.push({ lineId, kind: inferClaimKind(lower) })
  }
  return claims.slice(0, 4)
}

export function distanceKm(a: [number, number], b: [number, number]): number {
  const dLat = (b[0] - a[0]) * (Math.PI / 180)
  const dLon = (b[1] - a[1]) * (Math.PI / 180)
  const lat1 = a[0] * (Math.PI / 180)
  const lat2 = b[0] * (Math.PI / 180)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** Cell index `gr_r8_45.5120_-73.5613` → centre point; null when absent. */
export function cellPoint(cell: string | null | undefined): [number, number] | null {
  if (!cell || !cell.startsWith('gr_')) return null
  const parts = cell.split('_')
  const lat = Number.parseFloat(parts[2] ?? '')
  const lon = Number.parseFloat(parts[3] ?? '')
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null
}

function nearestStopKm(lineId: string, point: [number, number] | null): number | null {
  if (!point) return null
  const line = SEED_LINES.find((l) => l.id === lineId)
  if (!line) return null
  return Math.min(...line.stops.map((s) => distanceKm(point, [s.lat, s.lon])))
}

function checkClaim(claim: StoryClaim, snapshot: MatsimSnapshot): { lineLabel: string, simStatus: ServiceStatus, simDelaySec: number, simLoad: number, verdict: ClaimVerdict } | null {
  const state = snapshot.lines.find((l) => l.lineId === claim.lineId)
  const line = SEED_LINES.find((l) => l.id === claim.lineId)
  if (!state || !line) return null
  let verdict: ClaimVerdict
  switch (claim.kind) {
    case 'delay':
      verdict = state.avgDelaySec >= 120 ? 'confirms' : state.avgDelaySec >= 45 ? 'partially' : 'diverges'
      break
    case 'cancelled':
    case 'closed':
      verdict = state.status === 'suspended' || state.status === 'disrupted'
        ? 'confirms'
        : state.status === 'delayed' ? 'partially' : 'diverges'
      break
    case 'crowding':
      verdict = state.load >= 0.6 ? 'confirms' : state.load >= 0.4 ? 'partially' : 'diverges'
      break
    case 'mechanical': {
      const kinds = new Set<IncidentKind>(state.incidents.map((i) => i.kind))
      verdict = kinds.has('mechanical') || kinds.has('signal')
        ? 'confirms'
        : state.incidents.length > 0 ? 'partially' : 'diverges'
      break
    }
    default:
      verdict = 'unverifiable'
  }
  return { lineLabel: line.label, simStatus: state.status, simDelaySec: state.avgDelaySec, simLoad: state.load, verdict }
}

function motifOf(narrative: string): string {
  const sentence = narrative
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .sort((a, b) => b.length - a.length)[0] ?? ''
  const compact = sentence.replace(/\s+/g, ' ').trim()
  return compact.length > 90 ? compact.slice(0, 87) + '…' : compact
}

/** Full reading. Deterministic: same story + same snapshot ⇒ same reading. */
export function avaRead(
  channels: StoryChannels,
  snapshot: MatsimSnapshot | null,
  cell: string | null | undefined,
  signal?: StorySignal,
): AvaReading {
  const sig = signal ?? analyzeStory(channels)
  const point = cellPoint(cell)
  const claims = detectClaims(`${channels.functional}\n${channels.narrative}`)

  const correlations: AvaCorrelation[] = []
  for (const claim of claims) {
    if (!snapshot) {
      correlations.push({
        claim, lineLabel: claim.lineId, simStatus: 'nominal', simDelaySec: 0, simLoad: 0,
        verdict: 'out-of-sim', nearKm: nearestStopKm(claim.lineId, point),
      })
      continue
    }
    const checked = checkClaim(claim, snapshot)
    if (!checked) {
      correlations.push({
        claim, lineLabel: claim.lineId, simStatus: 'nominal', simDelaySec: 0, simLoad: 0,
        verdict: 'out-of-sim', nearKm: nearestStopKm(claim.lineId, point),
      })
      continue
    }
    correlations.push({
      claim,
      lineLabel: checked.lineLabel,
      simStatus: checked.simStatus,
      simDelaySec: checked.simDelaySec,
      simLoad: checked.simLoad,
      verdict: checked.verdict,
      nearKm: nearestStopKm(claim.lineId, point),
    })
  }

  const verifiable = correlations.filter((c) => c.verdict === 'confirms' || c.verdict === 'partially')
  const diverging = correlations.filter((c) => c.verdict === 'diverges')
  const outOfSim = correlations.filter((c) => c.verdict === 'out-of-sim')

  let verdict: AvaVerdict
  if (correlations.length === 0 || (verifiable.length === 0 && diverging.length === 0)) verdict = 'unverifiable'
  else if (diverging.length > 0 && verifiable.length === 0) verdict = 'diverges'
  else if (diverging.length > 0) verdict = 'partially'
  else verdict = 'confirms'

  const verdictScore = correlations.length === 0
    ? 0
    : Math.round(100 * (verifiable.length + 0.5 * diverging.length) / correlations.length)

  const parts: AvaPart[] = [{ kind: 'verdict', key: `ava.verdict.${verdict}` }]
  for (const c of correlations) {
    parts.push({
      kind: 'correlation',
      key: `ava.corr.${c.verdict}`,
      params: {
        line: c.lineLabel,
        status: c.simStatus,
        delay: c.simDelaySec,
        load: Math.round(c.simLoad * 100),
        near: c.nearKm === null ? -1 : Number(c.nearKm.toFixed(1)),
      },
    })
  }

  const motif = motifOf(channels.narrative)
  const dramaKey = sig.indicators.figurativeMarkers >= 0.34
    ? 'figurative'
    : sig.indicators.emotionalMarkers >= 0.34
      ? 'emotional'
      : sig.indicators.narrativeMarkers >= 0.3
        ? 'narrative'
        : 'sparse'
  parts.push({ kind: 'dramaturgical', key: `ava.drama.${dramaKey}`, params: { motif } })

  const quality: Array<[string, number]> = [
    ['q_time', sig.indicators.temporalSpecificity],
    ['q_quantity', sig.indicators.quantitativeSpecificity],
    ['q_line', claims.length > 0 ? 1 : sig.indicators.verifiableClaim * 0.6],
    ['q_place', point ? 1 : sig.indicators.spatialSpecificity * 0.6],
  ]
  const weak = quality.filter(([, v]) => v < 0.4).sort((a, b) => a[1] - b[1]).slice(0, 3)
  for (const [key] of weak) parts.push({ kind: 'quality', key: `ava.${key}` })

  const shareKey = sig.band === 'balanced' || sig.band === 'fact-leaning' || sig.band === 'saturated-facts'
    ? 'share_data'
    : 'share_story'
  parts.push({ kind: 'share', key: `ava.${shareKey}`, params: { facts: sig.facts, fiction: sig.fiction } })

  const verifiability = claims.length === 0 ? 0.25 : verifiable.length / claims.length
  const specificity = (sig.indicators.spatialSpecificity + sig.indicators.temporalSpecificity
    + sig.indicators.quantitativeSpecificity) / 3
  const dataValue = Math.round(sig.facts * 0.5 + verifiability * 100 * 0.3 + specificity * 100 * 0.2)

  const factors = [
    `claims:${claims.length}`,
    ...correlations.map((c) => `${c.claim.lineId}=${c.verdict}`),
    `facts:${sig.facts}`,
    `fiction:${sig.fiction}`,
    `reality:${sig.realityIndex}`,
    `verifiability:${verifiability.toFixed(2)}`,
    `specificity:${specificity.toFixed(2)}`,
    ...(outOfSim.length > 0 ? ['feed:missing-lines'] : []),
  ]

  return { verdict, verdictScore, dataValue, correlations, parts, factors }
}
