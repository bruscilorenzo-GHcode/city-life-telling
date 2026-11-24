/** AVA Story Record — deterministic synthetic corpus.
 *
 *  Generates EmitInput bundles for fixtures and for the 200-record
 *  end-to-end corpus (brief §9, day 5). The texts are invented synthetic
 *  stories (Montréal-style, FR/EN/IT) — no real citizen data, per project
 *  rule 7. The analysis bundle (signal, claims, reading) is computed with
 *  the app's own deterministic engines (signal.ts + ava-agent.ts + the
 *  seeded simulated snapshot), so the whole corpus is reproducible.
 *
 *  Pure: same index/profile ⇒ same EmitInput. */

import { avaRead, detectClaims } from '../ava-agent.ts'
import { simulateSnapshot } from '../matsim/simulated-source.ts'
import { analyzeStory } from '../signal.ts'
import type { EmitInput, EmitConsent } from './emit.ts'
import type { DayType, SourceKind, SourceMedium, TrustLevel } from './types.ts'

/** Fixed emit instant for the fixtures (never a live clock). */
export const FIXTURE_NOW = '2026-11-18T15:31:33Z'
/** Fixed instant the simulated snapshots are generated at (08:20 Montréal). */
export const CORPUS_WHEN = new Date('2026-11-16T13:20:00Z')

/** Anonymous deg-grid cells (synthetic Montréal locations). */
const CELLS = [
  'gr_r8_45.5100_-73.5600',
  'gr_r8_45.5300_-73.6100',
  'gr_r8_45.5400_-73.6300',
  'gr_r8_45.4900_-73.5800',
]

/** Synthetic story pool: invented, trilingual, covering the claim kinds
 *  the app's claim detector produces (delay / cancelled / crowding /
 *  closed / mechanical / other) plus dramaturgical-only stories. */
const SYNTHETIC_STORIES: ReadonlyArray<{ functional: string, narrative: string }> = [
  {
    functional: 'Bus 80 was 25 minutes late at Parc this morning, nobody at the stop had information.',
    narrative: 'I watched three buses of another route pass while the board promised a departure that never came; it felt like waiting inside a snow globe.',
  },
  {
    functional: 'Ligne orange bondée à 8h05, deux trains passés pleins avant de pouvoir monter.',
    narrative: 'Je me souviens de l’hiver dernier sur ce quai : on riait entre inconnus, serrés comme dans un vieux tramway de souvenirs.',
  },
  {
    functional: 'Il mio turno di notte comincia alle 23; prendo il métro 4 verso Longueuil e arrivo a casa dopo mezzanotte.',
    narrative: 'Ricordo il vagone vuoto, le luci gialle sul fiume: sembra un film che ho visto da bambina e che rivedo ogni notte.',
  },
  {
    functional: 'Ligne jaune suspendue ce dimanche entre Longueuil et l’Université de Sherbrooke, travaux annoncés toute la journée.',
    narrative: 'On a traversé le pont en navette, le fleuve glacé en bas ; on se serait croisés dans une histoire de voisinage.',
  },
  {
    functional: 'AVL feed: bus 139 breakdown near Pie-IX, doors blocked, single-tracking.',
    narrative: 'The driver kept calm while everyone called home; a small theatre of patience under the overpass.',
  },
  {
    functional: 'En retard de vingt minutes sur la ligne 121 encore une fois, trois matins sur cinq.',
    narrative: 'Chaque matin je recompte les minutes comme des pièces perdues ; c’est devenu un rituel, presque une chanson.',
  },
  {
    functional: 'Green line delayed between Berri and Papineau, no announcement for fifteen minutes.',
    narrative: 'We were a corridor of coats and silences; someone shared orange slices, and the delay turned almost warm.',
  },
  {
    functional: 'Oggi la linea verde era sospesa, ho perso il controllo medico di mio padre.',
    narrative: 'Sono rimasta sul marciapiede a guardare l’ospedale lontano; la città sembrava un negozio chiuso per ferie.',
  },
  {
    functional: 'Ho cambiato abitudine: vado in bicicletta perché la linea 54 non arriva mai al turno delle sei.',
    narrative: 'Il vento sul pont Jacques-Cartier è la mia nuova sveglia; la città si apre come un alone di radio.',
  },
  {
    functional: 'Alla stazione Lionel-Groulx il soffitto perde e non c’è nessun cartello che spieghi.',
    narrative: 'Aspettavo sotto la goccia come in un teatro senza palcoscenico; nessuno ha detto niente, e pure restavo.',
  },
]

export interface CorpusProfile {
  kind: SourceKind
  trust_level: TrustLevel
  language: string
  medium: SourceMedium
  calibration_use: 'granted' | 'denied'
  /** Optional override — 'event' lets row 6 fire for cf-present records. */
  day_type?: DayType
  geolocation?: boolean
}

/** Fixed profile per source kind (trust mapping documented for the team:
 *  request_311 = corroborated civic report, interview/panel = verified
 *  contribution, operator_feed = operator, assisted_story = weak signal). */
export const FIXTURE_PROFILES: Record<SourceKind, CorpusProfile> = {
  request_311: { kind: 'request_311', trust_level: 'D', language: 'en', medium: 'form', calibration_use: 'granted' },
  assisted_story: { kind: 'assisted_story', trust_level: 'E', language: 'fr', medium: 'text', calibration_use: 'granted' },
  interview: { kind: 'interview', trust_level: 'C', language: 'it', medium: 'voice_transcript', calibration_use: 'granted' },
  panel: { kind: 'panel', trust_level: 'C', language: 'fr', medium: 'form', calibration_use: 'granted' },
  operator_feed: { kind: 'operator_feed', trust_level: 'B', language: 'en', medium: 'sensor', calibration_use: 'granted' },
}

const KIND_CYCLE: ReadonlyArray<SourceKind> = [
  'assisted_story', 'request_311', 'panel', 'interview', 'operator_feed',
]

/** EmitInput for synthetic corpus entry `index` (0-based). Deterministic. */
export function syntheticEmitInput(index: number, profile: CorpusProfile, now: string): EmitInput {
  const story = SYNTHETIC_STORIES[index % SYNTHETIC_STORIES.length]!
  const cell = CELLS[index % CELLS.length]!
  const observed = new Date(CORPUS_WHEN.getTime() + (index % 60) * 7 * 60_000).toISOString()
  const signal = analyzeStory(story)
  const claims = detectClaims(`${story.functional}\n${story.narrative}`)
  const snapshot = simulateSnapshot((index % 40) + 1, index, CORPUS_WHEN, 'clt-corpus')
  const reading = avaRead(story, snapshot, cell, signal)
  const consent: EmitConsent = {
    geolocation: profile.geolocation ?? true,
    granularity: 'city',
    calibration_use: profile.calibration_use,
    regime: 'socio_narrative',
    licence: 'CC0-1.0',
  }
  return {
    source_kind: profile.kind,
    source_ref: `city-life-telling.stories.v1#st_synthetic${String(index).padStart(3, '0')}`,
    story_id: `st_synthetic${String(index).padStart(3, '0')}`,
    collected_at: observed,
    medium: profile.medium,
    language: profile.language,
    cell,
    trust_level: profile.trust_level,
    now,
    channels: { functional: story.functional, narrative: story.narrative },
    signal,
    claims,
    reading,
    consent,
    day_type: profile.day_type,
    snapshot: {
      contract: snapshot.contract,
      scenario: snapshot.scenario,
      tick: snapshot.tick,
      generatedAt: snapshot.generatedAt,
    },
  }
}

/** Corpus entry for index: kind cycles, consent denied every 7th, 'event'
 *  day every 10th (row 6), trust from the kind profile. */
export function syntheticCorpusInput(index: number, now = FIXTURE_NOW): EmitInput {
  const kind = KIND_CYCLE[index % KIND_CYCLE.length]!
  const base = FIXTURE_PROFILES[kind]
  const profile: CorpusProfile = {
    ...base,
    calibration_use: index % 7 === 3 ? 'denied' : base.calibration_use,
    day_type: index % 10 === 6 ? 'event' : undefined,
    geolocation: index % 11 === 5 ? false : true,
  }
  return syntheticEmitInput(index, profile, now)
}
