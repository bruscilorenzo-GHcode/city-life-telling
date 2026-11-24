export interface BridgeOptions {
  port?: number
  token?: string | null
}

export interface BridgeAddress {
  port: number
  address?: string
  family?: string
}

export interface BridgeHandle {
  server: unknown
  state: {
    snapshot: Record<string, unknown> | null
    weather: Record<string, unknown> | null
    tick: number
    updatedAt: string | null
  }
  history: Record<string, unknown>[]
  sseClients: Set<unknown>
  listen(callback?: (address: BridgeAddress) => void): unknown
  close(): void
}

export function startBridge(options?: BridgeOptions): BridgeHandle

export function parseLineState(raw: unknown): {
  ok: boolean
  reason?: string
  line?: Record<string, unknown>
}

export function parseFullSnapshot(raw: unknown): {
  ok: boolean
  reason?: string
  snapshot?: Record<string, unknown>
}

export function parseFullWeather(raw: unknown): {
  ok: boolean
  reason?: string
  weather?: Record<string, unknown>
}
