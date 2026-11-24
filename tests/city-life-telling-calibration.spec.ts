import { describe, expect, it } from 'vitest'
import { simulateSnapshot } from '../src/city-life-telling/matsim/simulated-source'
import {
  CALIBRATION_KEY,
  DEFAULT_CALIBRATION,
  EMPHASIS_PRESETS,
  FOCUS_PRESETS,
  applyCalibration,
  clockBreakdown,
  dayCurve,
  hourCurve,
  inFocus,
  linesInFocus,
  loadCalibration,
  monthCurve,
  sanitizeCalibration,
  saveCalibration,
} from '../src/city-life-telling/matsim/calibration'
import { agentDensity, generateAgents, positionAlong } from '../src/city-life-telling/matsim/agents'
import { SEED_LINES } from '../src/city-life-telling/matsim/network'

const WHEN = new Date('2026-11-05T13:20:00Z') // 08:20 Montréal — morning rush
const SNAPSHOT = simulateSnapshot(7, 12, WHEN, 'clt-test')
const FOCUS = FOCUS_PRESETS[0]!

function storage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

describe('the four clocks', () => {
  it('peaks in the morning rush and at night goes quiet', () => {
    const rush = hourCurve(WHEN)
    const night = hourCurve(new Date('2026-11-05T07:20:00Z')) // 02:20 Montréal
    expect(rush).toBeGreaterThan(night)
    expect(rush).toBeGreaterThan(1)
  })

  it('separates weekdays from weekends and winter from summer', () => {
    expect(dayCurve(new Date('2026-11-05T13:20:00Z'))).toBe(1) // Thursday
    expect(dayCurve(new Date('2026-11-08T13:20:00Z'))).toBeLessThan(0.7) // Sunday
    expect(monthCurve(new Date('2026-01-15T12:00:00Z'))).toBeGreaterThan(monthCurve(new Date('2026-07-15T12:00:00Z')))
  })

  it('composes the effective multiplier and is deterministic', () => {
    const a = clockBreakdown(DEFAULT_CALIBRATION, WHEN)
    const b = clockBreakdown(DEFAULT_CALIBRATION, WHEN)
    expect(a).toEqual(b)
    expect(a.effective).toBeGreaterThan(0.15)
    expect(a.effective).toBeLessThanOrEqual(4)
    for (const key of Object.keys(a) as Array<keyof typeof a>) {
      expect(Number.isFinite(a[key])).toBe(true)
    }
  })

  it('frame presets shift the dominant weight', () => {
    const hourHeavy = clockBreakdown({ ...DEFAULT_CALIBRATION, emphasis: 'hour', clocks: EMPHASIS_PRESETS.hour }, WHEN)
    const monthHeavy = clockBreakdown({ ...DEFAULT_CALIBRATION, emphasis: 'month', clocks: EMPHASIS_PRESETS.month }, WHEN)
    expect(hourHeavy.hour).not.toBe(monthHeavy.hour)
    expect(monthHeavy.month).toBeGreaterThan(hourHeavy.month)
  })
})

describe('parametric calibration', () => {
  it('scales the snapshot and stamps its meta with the factor', () => {
    const base = SNAPSHOT
    const calm = applyCalibration(base, { ...DEFAULT_CALIBRATION, demand: 0.5, congestionSensitivity: 0.5 }, WHEN)
    const heavy = applyCalibration(base, { ...DEFAULT_CALIBRATION, demand: 2, congestionSensitivity: 1.6 }, WHEN)
    expect(heavy.agents.onboard).toBeGreaterThan(calm.agents.onboard)
    expect(heavy.lines[0]!.avgDelaySec).toBeGreaterThan(calm.lines[0]!.avgDelaySec)
    expect(heavy.meta?.calibration_factor).toBeGreaterThan(Number(calm.meta?.calibration_factor))
    expect(heavy.meta?.calibration_focus).toBe(DEFAULT_CALIBRATION.focus.label)
    // load stays a valid occupancy index and delay is bounded
    for (const line of heavy.lines) {
      expect(line.load).toBeGreaterThanOrEqual(0)
      expect(line.load).toBeLessThanOrEqual(1)
      expect(line.avgDelaySec).toBeLessThan(20000)
      expect(['nominal', 'irregular', 'delayed', 'disrupted', 'suspended']).toContain(line.status)
    }
  })

  it('is deterministic for the same snapshot, config and time', () => {
    const a = applyCalibration(SNAPSHOT, DEFAULT_CALIBRATION, WHEN)
    const b = applyCalibration(SNAPSHOT, DEFAULT_CALIBRATION, WHEN)
    expect(a).toEqual(b)
  })

  it('sanitizes and persists the configuration', () => {
    const dirty = sanitizeCalibration({ demand: 99, clocks: { hour: -3, day: 'x' }, agentBudget: 5000, focus: { radiusKm: 42 } })
    expect(dirty.demand).toBe(3)
    expect(dirty.clocks.hour).toBe(0)
    expect(dirty.agentBudget).toBe(800)
    expect(dirty.focus.radiusKm).toBe(5)
    const store = storage()
    saveCalibration(dirty, store)
    expect(store.getItem(CALIBRATION_KEY)).toBeTruthy()
    expect(loadCalibration(store).agentBudget).toBe(800)
    expect(loadCalibration(null)).toEqual(DEFAULT_CALIBRATION)
  })
})

describe('focus area and containment', () => {
  it('contains points inside the radius and finds the crossing lines', () => {
    expect(inFocus(FOCUS, FOCUS.lat, FOCUS.lon)).toBe(true)
    expect(inFocus(FOCUS, FOCUS.lat + 0.2, FOCUS.lon)).toBe(false)
    const lines = linesInFocus(FOCUS)
    expect(lines).toContain('metro-green')
    expect(lines.length).toBeGreaterThan(0)
  })
})

describe('geolocalised agents', () => {
  const calibrated = applyCalibration(SNAPSHOT, DEFAULT_CALIBRATION, WHEN)

  it('is deterministic and capped by the agent budget', () => {
    const a = generateAgents(calibrated, { ...DEFAULT_CALIBRATION, agentBudget: 80 }, 12)
    const b = generateAgents(calibrated, { ...DEFAULT_CALIBRATION, agentBudget: 80 }, 12)
    expect(a).toEqual(b)
    expect(a.length).toBeLessThanOrEqual(80)
    expect(a.length).toBeGreaterThan(0)
  })

  it('generates agents only inside the focus area', () => {
    const agents = generateAgents(calibrated, { ...DEFAULT_CALIBRATION, agentBudget: 400 }, 12)
    expect(agents.length).toBeGreaterThan(1)
    for (const agent of agents) {
      expect(inFocus(DEFAULT_CALIBRATION.focus, agent.lat, agent.lon)).toBe(true)
      expect(agent.speed).toBeGreaterThan(0)
      expect(SEED_LINES.some((line) => line.id === agent.lineId)).toBe(true)
    }
  })

  it('renders more agents when demand rises (with budget headroom)', () => {
    // Keep demand below budget saturation: the focus rejection sampling
    // plateaus at the budget, so the comparison must stay under it.
    const calm = applyCalibration(SNAPSHOT, { ...DEFAULT_CALIBRATION, demand: 0.2, agentBudget: 800 }, WHEN)
    const busy = applyCalibration(SNAPSHOT, { ...DEFAULT_CALIBRATION, demand: 0.5, agentBudget: 800 }, WHEN)
    const calmAgents = generateAgents(calm, { ...DEFAULT_CALIBRATION, agentBudget: 800 }, 12)
    const busyAgents = generateAgents(busy, { ...DEFAULT_CALIBRATION, agentBudget: 800 }, 12)
    expect(busyAgents.length).toBeGreaterThan(calmAgents.length)
  })

  it('positions agents on the line geometry', () => {
    const [lat0, lon0] = positionAlong('metro-green', 0)
    const [lat1, lon1] = positionAlong('metro-green', 1)
    const line = SEED_LINES.find((l) => l.id === 'metro-green')!
    expect([lat0, lon0]).toEqual([line.stops[0]!.lat, line.stops[0]!.lon])
    expect([lat1, lon1]).toEqual([line.stops[line.stops.length - 1]!.lat, line.stops[line.stops.length - 1]!.lon])
  })
})

describe('city scope: density field + declared sample', () => {
  const calibrated = applyCalibration(SNAPSHOT, DEFAULT_CALIBRATION, WHEN)

  it('defaults to the focus scope and clamps the budget per scope', () => {
    expect(DEFAULT_CALIBRATION.scope).toBe('focus')
    expect(sanitizeCalibration({ scope: 'city', agentBudget: 5000 }).agentBudget).toBe(3000)
    expect(sanitizeCalibration({ scope: 'focus', agentBudget: 5000 }).agentBudget).toBe(800)
    expect(sanitizeCalibration({ scope: 'bogus' }).scope).toBe('focus')
    expect(applyCalibration(SNAPSHOT, DEFAULT_CALIBRATION, WHEN).meta?.calibration_scope).toBe('focus')
  })

  it('samples agents across the whole city (no focus rejection)', () => {
    const cfg = { ...DEFAULT_CALIBRATION, demand: 2, agentBudget: 800 }
    const focusAgents = generateAgents(calibrated, { ...cfg, scope: 'focus' as const }, 12)
    const cityAgents = generateAgents(calibrated, { ...cfg, scope: 'city' as const }, 12)
    expect(cityAgents.length).toBeGreaterThan(focusAgents.length)
    expect(cityAgents.length).toBeLessThanOrEqual(3000)
    // the city sample is not confined to the focus: at least one agent is outside it
    expect(cityAgents.some((agent) => !inFocus(DEFAULT_CALIBRATION.focus, agent.lat, agent.lon))).toBe(true)
    for (const agent of cityAgents) {
      expect(Number.isFinite(agent.lat)).toBe(true)
      expect(Number.isFinite(agent.lon)).toBe(true)
    }
  })

  it('builds a deterministic, normalised density field on ~1 km cells', () => {
    const a = agentDensity(calibrated)
    const b = agentDensity(calibrated)
    expect(a).toEqual(a)
    expect(a.length).toBeGreaterThan(4)
    expect(b).toEqual(a)
    const max = Math.max(...a.map((cell) => cell.weight))
    expect(max).toBeCloseTo(1, 5)
    for (const cell of a) {
      expect(cell.weight).toBeGreaterThanOrEqual(0)
      expect(cell.weight).toBeLessThanOrEqual(1)
      expect(cell.agents).toBeGreaterThanOrEqual(0)
      // cells sit on the coarse Montreal seed area
      expect(cell.lat).toBeGreaterThan(45.3)
      expect(cell.lat).toBeLessThan(45.7)
      expect(cell.lon).toBeGreaterThan(-74.1)
      expect(cell.lon).toBeLessThan(-73.4)
    }
  })
})
