/** CITY-LIFE-TELLING — provisional access key for the AVA box.
 *
 *  The AVA agent's readings live in a reserved box. The box opens with a
 *  **provisional key**, generated on request together with the AVA
 *  assistant (the coding agent) for the curators: the scheme is
 *
 *      CLT-AVA-<YYYYMM>-<checksum4>
 *
 *  where checksum4 is the FNV-1a digest of `<salt>:<period>` (salt is a
 *  build constant). Keys rotate monthly and stay valid one month around
 *  their period — deliberately provisional: a workshop key does not open
 *  the box forever, and the curators ask AVA for the next one when it
 *  expires. This is a soft, demo-level gate: it protects the agent's
 *  attention, not a secret. */

const SALT = 'city-life-telling-ava-v1'
const KEY_PATTERN = /^CLT-AVA-(\d{6})-([0-9a-f]{4})$/i

function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
    h ^= h >>> 13
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return (h >>> 0).toString(16).slice(0, 4).padStart(4, '0')
}

/** YYYYMM of a date, UTC. */
export function periodOf(when: Date = new Date()): string {
  const y = String(when.getUTCFullYear()).padStart(4, '0')
  const m = String(when.getUTCMonth() + 1).padStart(2, '0')
  return `${y}${m}`
}

function periodDistance(a: string, b: string): number {
  const ay = Number(a.slice(0, 4))
  const am = Number(a.slice(4, 6))
  const by = Number(b.slice(0, 4))
  const bm = Number(b.slice(4, 6))
  return Math.abs(ay * 12 + am - (by * 12 + bm))
}

/** Generate a provisional key for a period (default: current month). */
export function generateKey(period: string = periodOf()): string {
  return `CLT-AVA-${period}-${fnv1a(`${SALT}:${period}`)}`
}

/** Valid when well-formed, checksummed and within ±1 month of `when`. */
export function isValidKey(key: string, when: Date = new Date()): boolean {
  const match = KEY_PATTERN.exec(key.trim())
  if (!match) return false
  const [, period, checksum] = match
  return checksum!.toLowerCase() === fnv1a(`${SALT}:${period}`) && periodDistance(period!, periodOf(when)) <= 1
}
