/** CITY-LIFE-TELLING — fiction ⇄ facts signal engine.
 *
 *  Every story carries a dramaturgical channel and a critical-functional
 *  channel. This module measures how the two relate: deterministic,
 *  trilingual (fr/en/it) lexicon heuristics produce indicator scores in
 *  [0,1] and two headline numbers — FACTS and FICTION in [0,100] — plus the
 *  reality index (facts weight over their sum). The engine never rejects a
 *  story: fiction is a legitimate dramaturgical component, it is *measured*
 *  so quality data can be collected without killing the narrative. */

export interface StoryChannels {
  narrative: string
  functional: string
}

export interface SignalIndicators {
  temporalSpecificity: number
  quantitativeSpecificity: number
  spatialSpecificity: number
  verifiableClaim: number
  narrativeMarkers: number
  emotionalMarkers: number
  figurativeMarkers: number
}

export interface StorySignal {
  facts: number
  fiction: number
  realityIndex: number
  band: 'saturated-fiction' | 'narrative-leaning' | 'balanced' | 'fact-leaning' | 'saturated-facts'
  indicators: SignalIndicators
  /** Human-readable drivers, ordered by weight (explainability). */
  drivers: string[]
}

interface Lexicon {
  timeMarkers: RegExp
  quantityMarkers: RegExp
  verifiableMarkers: RegExp
  narrativeMarkers: RegExp
  emotionalMarkers: RegExp
  figurativeMarkers: RegExp
}

/** Trilingual (FR/EN/IT) — Montréal stories are francophone first. */
const RE: Lexicon = {
  timeMarkers: /\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}h\b|\b\d{1,2}:\d{2}\b|\b(oggi|hier|ier soir|ce matin|cette nuit|ce soir|aujourd'hui|hier matin|quest'oggi|ieri|stamattina|ieri sera|stanotte|stasera|domani|today|yesterday|tonight|this morning|last night)\b/gi,
  quantityMarkers: /\b\d+([.,]\d+)?\b|\b(dix|vingt|trente|quarante|cinquante|demi|doppio|doppia|tre|quattro|cinque|due|trois|quatre|cinq|deux|dozen|pair)\b/gi,
  verifiableMarkers: /\b(in ritardo|ritardo|annullat[oaie]|soppress[oa]|soppresso|sospes[oa]|deviat[oa]|chius[oa]|guast[oa]|panne|bloccat[oa]|colonn[ae]|affollat[oa]|coda|attesa|attese|attendant|en retard|retard|annul[ée]e?s?|suspendu[e?s]?|d[ée]vi[ée]|ferm[ée]|bloqu[ée]|panne|rue[ée]?|bours[ée]?:?|coincé|bond[ée]|attente|attendent|delayed|delay|cancelled?|canceled?|suspended|rerouted?|diverted|closed?|shut|breakdown|broke down|stuck|crowded|packed|queue|waiting|wait|no[- ]show|headway|service)\b/gi,
  narrativeMarkers: /\b(mi ricordo|ricordo|ricordavo|una volta|da bambin[oa]|da ragazz[oa]|il ricordo|mi sembra|mi sembrava|raccont[oa]|storia|je me souviens|souvenir|je rappelle|m'[aè]|ça fait|dans le temps|enfant|vieil?|i remember|remember|used to|when i was|back then|story|it feels|felt like|as if|seemed)\b/gi,
  emotionalMarkers: /\b(colera|rabbia|paura|gioia|fretta|stanchezza|sollievo|attesa ansiosa|nostalgia|meraviglia|dolce|amaro|mi piace|odio|colère|peur|joie|tristesse|fatigue|espioir|espoir|détente|angoisse|nostalgie|émerveillement|j'aime|je déteste|anger|fear|joy|sadness|tired|relief|wonder|love|hate|anxious|nostalgic|exhausted|peaceful)\b/gi,
  figurativeMarkers: /\b(come (?:un[oa']|il|lo|la|una)|sembra(?:va)? un[oa']?|par-un[oa]?|tel que|comme (?:un[ea]|une|le|la)|on dirait|si conferma|è come|era come|like (?:a|an|the)|as if|seemed like|felt like|reminds me of|ressemble)\b/gi,
}

function countMatches(text: string, re: RegExp): number {
  const found = text.match(re)
  return found ? found.length : 0
}

function sat(count: number, per100: number): number {
  return Math.min(1, count / per100)
}

/** 0..100 scale, safe rounding. */
const round = (n: number) => Math.round(Math.max(0, Math.min(100, n)))

function indicatorsFor(text: string): SignalIndicators {
  const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length)
  const per100 = (count: number) => (count / words) * 100
  return {
    temporalSpecificity: sat(per100(countMatches(text, RE.timeMarkers)), 1.6),
    quantitativeSpecificity: sat(per100(countMatches(text, RE.quantityMarkers)), 3.2),
    spatialSpecificity: sat(per100(countMatches(text, /\b(station|stazione|arrêt|stop|quai|binario|platform|bordo|fermata|direction|verso|vers|toward|intersezione|incrocio|intersection|coin|rue|via|street|avenue|boulevard)\b/gi)), 2.2),
    verifiableClaim: sat(per100(countMatches(text, RE.verifiableMarkers)), 2.4),
    narrativeMarkers: sat(per100(countMatches(text, RE.narrativeMarkers)), 2.4),
    emotionalMarkers: sat(per100(countMatches(text, RE.emotionalMarkers)), 2.0),
    figurativeMarkers: sat(per100(countMatches(text, RE.figurativeMarkers)), 1.2),
  }
}

const avg = (ns: number[]) => ns.reduce((a, n) => a + n, 0) / Math.max(1, ns.length)

export function bandFor(realityIndex: number): StorySignal['band'] {
  if (realityIndex < 25) return 'saturated-fiction'
  if (realityIndex < 42) return 'narrative-leaning'
  if (realityIndex <= 58) return 'balanced'
  if (realityIndex <= 75) return 'fact-leaning'
  return 'saturated-facts'
}

/** Measure one story. Both channels are required by the composer; the
 *  engine scores them jointly but weighs the functional text slightly
 *  higher for facts and the narrative text for fiction. */
export function analyzeStory(channels: StoryChannels): StorySignal {
  const functional = channels.functional ?? ''
  const narrative = channels.narrative ?? ''
  const fi = indicatorsFor(functional)
  const na = indicatorsFor(narrative)

  const facts = round(
    100 * avg([
      0.85 * fi.temporalSpecificity + 0.15 * na.temporalSpecificity,
      0.85 * fi.quantitativeSpecificity + 0.15 * na.quantitativeSpecificity,
      0.7 * fi.spatialSpecificity + 0.3 * na.spatialSpecificity,
      0.9 * fi.verifiableClaim + 0.1 * na.verifiableClaim,
    ]),
  )
  const fiction = round(
    100 * avg([
      0.2 * fi.narrativeMarkers + 0.8 * na.narrativeMarkers,
      0.15 * fi.emotionalMarkers + 0.85 * na.emotionalMarkers,
      0.1 * fi.figurativeMarkers + 0.9 * na.figurativeMarkers,
    ]),
  )

  const total = facts + fiction
  const realityIndex = total === 0 ? 50 : round((facts / total) * 100)

  const drivers: Array<{ weight: number, label: string }> = [
    { weight: na.narrativeMarkers, label: 'narrative_markers' },
    { weight: na.emotionalMarkers, label: 'emotional_markers' },
    { weight: na.figurativeMarkers, label: 'figurative_markers' },
    { weight: fi.verifiableClaim, label: 'verifiable_claim' },
    { weight: fi.temporalSpecificity, label: 'temporal_specificity' },
    { weight: fi.quantitativeSpecificity, label: 'quantitative_specificity' },
    { weight: fi.spatialSpecificity, label: 'spatial_specificity' },
  ]
  return {
    facts,
    fiction,
    realityIndex,
    band: bandFor(realityIndex),
    indicators: { ...fi, ...na },
    drivers: drivers.sort((a, b) => b.weight - a.weight).slice(0, 3).map((d) => d.label),
  }
}
