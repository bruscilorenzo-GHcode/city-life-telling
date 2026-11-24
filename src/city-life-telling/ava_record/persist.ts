/** AVA Story Record — additive local persistence.
 *
 *  A local, append-only list of emitted records under
 *  `city-life-telling.ava-records.v1` (localStorage), FIFO-capped at 200.
 *  Records are never mutated: a revision is a NEW record with
 *  `supersedes` = the previous record_id and revision + 1 (I9). Adding the
 *  same content twice is a no-op (same content_hash).
 *
 *  Fail-closed: an invalid record is refused, never stored or silently
 *  repaired. Everything is additive — nothing here changes the existing
 *  app behaviour; emission at publish happens only behind the local flag
 *  `city-life-telling.ava-record-emit.v1` ('on'). */

import type { CityStory } from '../store.js'
import { emitRecord, type EmitInput, type EmitResult } from './emit.ts'
import { validateStoryRecord, type StoryRecord } from './types.ts'

export const RECORDS_KEY = 'city-life-telling.ava-records.v1'
export const EMIT_FLAG_KEY = 'city-life-telling.ava-record-emit.v1'
export const MAX_RECORDS = 200

export interface MinimalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Load the stored records; corrupt or invalid entries are dropped
 *  (fail-closed), the list is never trusted blindly. */
export function loadRecords(storage: MinimalStorage | null | undefined): StoryRecord[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(RECORDS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r): r is StoryRecord => validateStoryRecord(r).ok)
  } catch {
    return []
  }
}

export interface AddResult {
  records: StoryRecord[]
  added: boolean
  reason?: 'invalid_record' | 'duplicate' | 'storage_unavailable'
  errors?: string[]
}

/** Append a record (append-only, FIFO cap 200). A record whose
 *  content_hash already exists is not added again (I9 idempotency). */
export function addRecord(record: StoryRecord, storage: MinimalStorage | null | undefined): AddResult {
  if (!storage) return { records: [], added: false, reason: 'storage_unavailable' }
  const validation = validateStoryRecord(record)
  if (!validation.ok) {
    return {
      records: loadRecords(storage),
      added: false,
      reason: 'invalid_record',
      errors: validation.errors.map((e) => `${e.path}: ${e.message}`),
    }
  }
  const records = loadRecords(storage)
  if (records.some((r) => r.content_hash === record.content_hash)) {
    return { records, added: false, reason: 'duplicate' }
  }
  const next = [...records, record].slice(-MAX_RECORDS)
  try {
    storage.setItem(RECORDS_KEY, JSON.stringify(next))
  } catch {
    // Quota or privacy mode: the session still works, persistence is optional.
  }
  return { records: next, added: true }
}

export interface SupersedeResult {
  ok: boolean
  record?: StoryRecord
  reason?: 'emit_rejected' | 'storage_unavailable'
  errors?: string[]
}

/** Revision path: emit a NEW record superseding `previous` (revision + 1,
 *  supersedes = previous.record_id). The caller supplies the full emit
 *  input rebuilt from the updated story (the record itself carries no raw
 *  text to re-extract from — fail-closed by design). The previous record
 *  stays untouched: append-only. */
export function supersedeRecord(
  previous: StoryRecord,
  input: EmitInput,
  now: string,
  storage: MinimalStorage | null | undefined,
): SupersedeResult {
  const result = emitRecord({ ...input, revision: previous.revision + 1, supersedes: previous.record_id, now })
  if (!result.ok) return { ok: false, reason: 'emit_rejected', errors: result.errors }
  if (!storage) return { ok: false, reason: 'storage_unavailable' }
  const added = addRecord(result.record, storage)
  return added.added
    ? { ok: true, record: result.record }
    : { ok: false, reason: 'emit_rejected', errors: added.errors }
}

/** Is local flag-gated emission enabled for this device? */
export function emitEnabled(storage: MinimalStorage | null | undefined): boolean {
  try {
    return storage?.getItem(EMIT_FLAG_KEY) === 'on'
  } catch {
    return false
  }
}

/** Build the emit input for a published story (additive publish hook).
 *  Calibration consent is NOT collected by the app yet (spec §12): the
 *  flag-gated emission records `calibration_use: 'denied'` — the record is
 *  stored and rendered, never calibration-eligible. The story's compact
 *  AVA verdict is mapped into the reading shape (no correlations persisted
 *  in CityStory). */
export function emitInputForStory(story: CityStory, now: string): EmitInput {
  return {
    source_kind: 'assisted_story',
    source_ref: `city-life-telling.stories.v1#${story.id}`,
    story_id: story.id,
    collected_at: story.ts,
    medium: 'text',
    language: story.lang,
    cell: story.geo?.index ?? null,
    trust_level: 'E',
    now,
    channels: { functional: story.functional, narrative: story.narrative },
    signal: story.signal,
    claims: story.claims,
    reading: {
      verdict: story.ava.verdict,
      verdictScore: story.ava.verdictScore,
      dataValue: story.ava.dataValue,
      correlations: [],
      parts: [],
      factors: [],
    },
    consent: {
      geolocation: story.geo !== null,
      granularity: 'city',
      calibration_use: 'denied',
      regime: 'socio_narrative',
      licence: 'CC0-1.0',
    },
    snapshot: story.snapshot_ref,
  }
}

/** Additive publish hook: emit + persist a record for a published story,
 *  ONLY when the local flag `EMIT_FLAG_KEY` is 'on'. Never throws, no-op
 *  outside a browser or when the flag is off — the existing publish flow
 *  is untouched. */
export function maybeEmitForStory(story: CityStory): EmitResult | null {
  try {
    const ls = (globalThis as { localStorage?: MinimalStorage }).localStorage
    if (!ls || !emitEnabled(ls)) return null
    const result = emitRecord(emitInputForStory(story, story.ts))
    if (result.ok) addRecord(result.record, ls)
    return result
  } catch {
    return null // additive: the publish flow must never break
  }
}
