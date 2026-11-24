/** CITY-LIFE-TELLING — weather layer (contract `clt.weather.v0`).
 *
 *  One of the two inputs of the decision model. Same adapter pattern as the
 *  MATSim layer: a deterministic on-device **simulated** forecast (labelled
 *  SYNTHETIC, enough for the strategy matrix to breathe) and an **HTTP**
 *  source that polls a JSON endpoint speaking the draft contract — the real
 *  feed (or an open-data forecast API mediated by the Polytechnique team)
 *  will replace it without touching the decision model.
 *
 *  Montreal, November: the simulated engine produces credible cold-season
 *  sequences (snow, freezing rain, wind) as a pure function of
 *  (seed, day, hour). */

import { hash01 } from './matsim/simulated-source.js'

export const WEATHER_CONTRACT = 'clt.weather.v0'

export type PrecipKind = 'none' | 'rain' | 'snow' | 'freezing'
export type WeatherAlert = 'none' | 'wind' | 'snow' | 'ice' | 'storm' | 'heat' | 'cold'

export interface WeatherPeriod {
  /** Non-unique label of the window ('now', 'next 6h', '12–24h'). */
  id: 'now' | 'next' | 'later'
  hours: number
  tempC: number
  precipMm: number
  precipKind: PrecipKind
  windKmh: number
  alert: WeatherAlert
}

export interface WeatherForecast {
  contract: typeof WEATHER_CONTRACT
  place: string
  issuedAt: string
  periods: WeatherPeriod[]
  meta?: Record<string, string | number>
}

export type WeatherListener = (forecast: WeatherForecast) => void

export interface WeatherSource {
  readonly kind: 'simulated' | 'http'
  start(onForecast: WeatherListener, onError?: (error: Error) => void): void
  stop(): void
  latest(): WeatherForecast | null
}

/* -------------------------------------------------------- stress metric */

/** 0..1 — how much a period stresses transport operations and people. */
export function periodStress(period: WeatherPeriod): number {
  const precipStress = period.precipKind === 'none' ? 0 : Math.min(1, period.precipMm / 15)
  const alertStress: Record<WeatherAlert, number> = {
    none: 0, wind: 0.5, snow: 0.65, ice: 0.85, storm: 0.8, heat: 0.6, cold: 0.7,
  }
  const thermal = period.tempC <= -18 ? 0.6 : period.tempC >= 30 ? 0.5 : 0
  return Math.min(1, Math.max(precipStress, alertStress[period.alert], thermal))
}

export function forecastStress(forecast: WeatherForecast): number {
  const first = forecast.periods.slice(0, 2)
  return first.length === 0 ? 0 : first.reduce((a, p) => a + periodStress(p), 0) / first.length
}

/* ------------------------------------------------------ simulated feed */

export function simulateWeather(seed: number, when: Date): WeatherForecast {
  const day = Math.floor(when.getTime() / 86400000)
  const hour = when.getUTCHours()
  const season = Math.cos(((day - 15) / 365) * 2 * Math.PI) // ≈1 in January
  const baseTemp = 2 - 14 * season + (hash01(seed, day, 1) - 0.5) * 8
  const periods: WeatherPeriod[] = (['now', 'next', 'later'] as const).map((id, index) => {
    const slot = day * 24 + hour + index * 6
    const tempC = Math.round((baseTemp + (hash01(seed, slot, 2) - 0.5) * 5) * 10) / 10
    const precipRoll = hash01(seed, slot, 3)
    const wetness = hash01(seed, slot, 4)
    const cold = tempC <= 0.5
    const freezing = tempC > -2 && tempC <= 0.5 && precipRoll < 0.3
    const precipMm = precipRoll < 0.45 ? Math.round(wetness * 18 * 10) / 10 : 0
    const precipKind: PrecipKind = precipMm === 0 ? 'none' : freezing ? 'freezing' : cold ? 'snow' : 'rain'
    const windKmh = Math.round(8 + hash01(seed, slot, 5) * (30 + 40 * hash01(seed, slot, 6)))
    const alert: WeatherAlert =
      freezing ? 'ice'
      : precipKind === 'snow' && precipMm >= 6 ? 'snow'
      : windKmh >= 60 ? 'wind'
      : precipKind === 'rain' && precipMm >= 12 ? 'storm'
      : tempC >= 30 ? 'heat'
      : tempC <= -18 ? 'cold'
      : 'none'
    return { id, hours: id === 'later' ? 12 : 6, tempC, precipMm, precipKind, windKmh, alert }
  })
  return {
    contract: WEATHER_CONTRACT,
    place: 'Montréal',
    issuedAt: when.toISOString(),
    periods,
    meta: { seed, mode: 'simulated' },
  }
}

export class SimulatedWeatherSource implements WeatherSource {
  readonly kind = 'simulated' as const
  private timer: ReturnType<typeof setInterval> | null = null
  private last: WeatherForecast | null = null
  private readonly seed: number

  constructor(seed: number) {
    this.seed = seed | 0
  }

  start(onForecast: WeatherListener, onError?: (error: Error) => void): void {
    if (this.timer) return
    const emit = () => {
      try {
        this.last = simulateWeather(this.seed, new Date())
        onForecast(this.last)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
    emit()
    this.timer = setInterval(emit, 60000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  latest(): WeatherForecast | null {
    return this.last
  }
}

/* ---------------------------------------------------------- HTTP source */

export type WeatherParseResult =
  | { ok: true, forecast: WeatherForecast }
  | { ok: false, reason: string }

export function parseWeather(raw: unknown): WeatherParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload is not an object' }
  const data = raw as Record<string, unknown>
  if (data.contract !== WEATHER_CONTRACT) {
    return { ok: false, reason: `contract must be ${WEATHER_CONTRACT}, got ${JSON.stringify(data.contract)}` }
  }
  if (typeof data.issuedAt !== 'string' || Number.isNaN(Date.parse(data.issuedAt))) {
    return { ok: false, reason: 'issuedAt must be an ISO date' }
  }
  if (!Array.isArray(data.periods) || data.periods.length === 0) return { ok: false, reason: 'periods[] required' }
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null
  const periods: WeatherPeriod[] = []
  for (const entry of data.periods) {
    if (!entry || typeof entry !== 'object') return { ok: false, reason: 'period must be an object' }
    const p = entry as Record<string, unknown>
    const id = p.id === 'now' || p.id === 'next' || p.id === 'later' ? p.id : null
    const tempC = num(p.tempC, -60, 55)
    const precipMm = num(p.precipMm, 0, 200)
    const windKmh = num(p.windKmh, 0, 250)
    const hours = num(p.hours, 1, 24)
    if (!id || tempC === null || precipMm === null || windKmh === null || hours === null) {
      return { ok: false, reason: 'period fields out of range' }
    }
    const precipKind = ['none', 'rain', 'snow', 'freezing'].includes(String(p.precipKind)) ? p.precipKind as PrecipKind : 'none'
    const alert = ['none', 'wind', 'snow', 'ice', 'storm', 'heat', 'cold'].includes(String(p.alert)) ? p.alert as WeatherAlert : 'none'
    periods.push({ id, hours, tempC, precipMm, precipKind, windKmh, alert })
  }
  return {
    ok: true,
    forecast: {
      contract: WEATHER_CONTRACT,
      place: typeof data.place === 'string' ? data.place : 'Montréal',
      issuedAt: data.issuedAt,
      periods,
      meta: (data.meta ?? undefined) as WeatherForecast['meta'],
    },
  }
}

export class HttpWeatherSource implements WeatherSource {
  readonly kind = 'http' as const
  private timer: ReturnType<typeof setInterval> | null = null
  private source: EventSource | null = null
  private last: WeatherForecast | null = null
  private readonly url: string
  private readonly fetcher: typeof fetch

  constructor(url: string, fetcher?: typeof fetch) {
    this.url = url
    this.fetcher = fetcher ?? ((...args) => fetch(...args))
  }

  start(onForecast: WeatherListener, onError?: (error: Error) => void): void {
    if (this.timer || this.source) return
    if (this.url.includes('/stream') && typeof EventSource !== 'undefined') {
      const es = new EventSource(this.url)
      es.addEventListener('weather', (event) => {
        try {
          const parsed = parseWeather(JSON.parse((event as MessageEvent).data as string))
          if (!parsed.ok) throw new Error(parsed.reason)
          this.last = parsed.forecast
          onForecast(parsed.forecast)
        } catch (error) {
          onError?.(error instanceof Error ? error : new Error(String(error)))
        }
      })
      es.onerror = () => onError?.(new Error('stream interrupted — reconnecting'))
      this.source = es
      return
    }
    const poll = async () => {
      try {
        const res = await this.fetcher(this.url, { headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const parsed = parseWeather(await res.json())
        if (!parsed.ok) throw new Error(parsed.reason)
        this.last = parsed.forecast
        onForecast(parsed.forecast)
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
    void poll()
    this.timer = setInterval(() => void poll(), 600000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.source) { this.source.close(); this.source = null }
  }

  latest(): WeatherForecast | null {
    return this.last
  }
}
