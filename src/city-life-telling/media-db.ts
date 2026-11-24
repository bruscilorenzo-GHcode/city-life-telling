/** CITY-LIFE-TELLING — local multimedia store (10 MB per story).
 *
 *  Stories can carry photo, video, voice and text media. Files never leave
 *  the device: blobs live in IndexedDB under an opaque id, the story record
 *  keeps only kind/size/id. Share links travel text-only (a 10 MB blob does
 *  not fit a URL) — media stay where they were born. When the Polytechnique
 *  coupling or a hosted store is defined, this adapter is the seam to swap.
 *
 *  Environments without IndexedDB (tests, privacy modes) fall back to an
 *  in-memory store so the session still works, persistence is optional. */

export interface ClMediaRef {
  id: string
  kind: 'image' | 'video' | 'audio' | 'text'
  size: number
}

export const MEDIA_TOTAL_BUDGET = 10 * 1024 * 1024
const MAX_FILES = 8
const ACCEPTED = new Set(['image', 'video', 'audio', 'text'])

const DB_NAME = 'city-life-telling-media'
const STORE = 'media'

function kindOf(type: string, name: string): ClMediaRef['kind'] | null {
  const t = type || guessType(name)
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('text/') || /\.(txt|md|csv)$/i.test(name)) return 'text'
  return null
}

function guessType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic'].includes(ext)) return 'image/*'
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video/*'
  if (['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'].includes(ext)) return 'audio/*'
  if (['txt', 'md', 'csv'].includes(ext)) return 'text/plain'
  return 'application/octet-stream'
}

function randomHex(n: number): string {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Client-side budget check. Returns an error code understood by the UI. */
export function validateMediaBatch(files: File[]): 'budget' | 'type' | 'count' | null {
  if (files.length > MAX_FILES) return 'count'
  let total = 0
  for (const f of files) {
    if (!kindOf(f.type, f.name)) return 'type'
    total += f.size
  }
  return total > MEDIA_TOTAL_BUDGET ? 'budget' : null
}

export function totalSize(files: File[]): number {
  return files.reduce((n, f) => n + f.size, 0)
}

/* ------------------------------------------------------------- storage */

const memory = new Map<string, { kind: ClMediaRef['kind'], type: string, blob: Blob }>()
const urlCache = new Map<string, string>()

function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB unavailable'))
  })
}

/** Store one file under an opaque id; returns the reference for the story. */
export async function putMedia(file: File): Promise<ClMediaRef> {
  const kind = kindOf(file.type, file.name)
  if (!kind) throw new Error('type')
  const id = 'md_' + randomHex(8)
  const type = file.type || guessType(file.name)
  if (hasIndexedDB()) {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ kind, type, blob: file }, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB write failed'))
    })
    db.close()
  } else {
    memory.set(id, { kind, type, blob: file })
  }
  return { id, kind, size: file.size }
}

async function readBlob(ref: ClMediaRef): Promise<{ kind: ClMediaRef['kind'], type: string, blob: Blob } | null> {
  if (hasIndexedDB()) {
    const db = await openDb()
    const record = await new Promise<{ kind: ClMediaRef['kind'], type: string, blob: Blob } | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(ref.id)
      req.onsuccess = () => resolve((req.result ?? null) as { kind: ClMediaRef['kind'], type: string, blob: Blob } | null)
      req.onerror = () => reject(req.error ?? new Error('indexedDB read failed'))
    })
    db.close()
    return record
  }
  return memory.get(ref.id) ?? null
}

/** Object URL for rendering; cached per id. Returns null when the media is
 *  not on this device (e.g. an echoed story). */
export async function mediaUrl(ref: ClMediaRef): Promise<string | null> {
  const cached = urlCache.get(ref.id)
  if (cached) return cached
  const record = await readBlob(ref)
  if (!record) return null
  const url = URL.createObjectURL(record.blob)
  urlCache.set(ref.id, url)
  return url
}

export function dropUrlCache(id: string): void {
  const url = urlCache.get(id)
  if (url) URL.revokeObjectURL(url)
  urlCache.delete(id)
}

export async function deleteMedia(id: string): Promise<void> {
  dropUrlCache(id)
  memory.delete(id)
  if (!hasIndexedDB()) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB delete failed'))
  })
  db.close()
}

export { ACCEPTED as MEDIA_KINDS, MAX_FILES as MEDIA_MAX_FILES }
