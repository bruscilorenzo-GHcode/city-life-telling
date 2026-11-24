import { describe, expect, it } from 'vitest'
import { routeAnnotation, type RoutingAnnotation } from '../src/city-life-telling/ava_record/route.ts'

function ann(overrides: Partial<RoutingAnnotation>): RoutingAnnotation {
  return {
    problem_class: 'none',
    critical_functional_present: false,
    day_type: 'weekday',
    od_pair_present: false,
    dramaturgical_mention_shift: false,
    subject: 'bus-80',
    ...overrides,
  }
}

/** Golden table: the twelve rows of brief §3. */
interface GoldenCase extends RoutingAnnotation {
  name: string
  rule_id: number
  parameter_class: string
  direction: string
  target: string
  parameter_key: string
}

const GOLDEN: GoldenCase[] = [
  {
    name: 'row 1 — vehicle_full',
    problem_class: 'vehicle_full', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'bus-80',
    rule_id: 1, parameter_class: 'theta_cap', direction: 'decrease', target: 'stop', parameter_key: 'capacity.stop.bus-80',
  },
  {
    name: 'row 2 — boarding_denied',
    problem_class: 'boarding_denied', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'metro-orange',
    rule_id: 2, parameter_class: 'theta_cap', direction: 'decrease', target: 'stop', parameter_key: 'capacity.stop.metro-orange',
  },
  {
    name: 'row 2 — waiting_excessive',
    problem_class: 'waiting_excessive', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'bus-80',
    rule_id: 2, parameter_class: 'theta_cap', direction: 'decrease', target: 'stop', parameter_key: 'capacity.stop.bus-80',
  },
  {
    name: 'row 3 — infrastructure_condition',
    problem_class: 'infrastructure_condition', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 3, parameter_class: 'theta_cap', direction: 'decrease', target: 'facility', parameter_key: 'capacity.facility.gr_r8_45.51_-73.56',
  },
  {
    name: 'row 4 — bunching',
    problem_class: 'bunching', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'bus-139',
    rule_id: 4, parameter_class: 'theta_cap', direction: 'decrease', target: 'link', parameter_key: 'capacity.link.bus-139',
  },
  {
    name: 'row 4 — punctuality',
    problem_class: 'punctuality', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'bus-139',
    rule_id: 4, parameter_class: 'theta_cap', direction: 'decrease', target: 'link', parameter_key: 'capacity.link.bus-139',
  },
  {
    name: 'row 5 — incident',
    problem_class: 'incident', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'bus-139',
    rule_id: 5, parameter_class: 'theta_evt', direction: 'decrease', target: 'link', parameter_key: 'event.link.bus-139',
  },
  {
    name: 'row 5 — works',
    problem_class: 'works', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'metro-yellow',
    rule_id: 5, parameter_class: 'theta_evt', direction: 'decrease', target: 'link', parameter_key: 'event.link.metro-yellow',
  },
  {
    name: 'row 6 — event day with a functional report',
    problem_class: 'other', critical_functional_present: true, day_type: 'event', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 6, parameter_class: 'theta_evt', direction: 'increase', target: 'zone', parameter_key: 'event.zone.gr_r8_45.51_-73.56',
  },
  {
    name: 'row 7 — demand_volume with od_pair',
    problem_class: 'demand_volume', critical_functional_present: true, day_type: 'weekday', od_pair_present: true,
    dramaturgical_mention_shift: false, subject: 'od:parc:mont-royal',
    rule_id: 7, parameter_class: 'theta_OD', direction: 'increase', target: 'od_pair', parameter_key: 'demand.od_pair.od:parc:mont-royal',
  },
  {
    name: 'row 8 — dramaturgical shift mention',
    problem_class: 'other', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: true, subject: 'metro-yellow',
    rule_id: 8, parameter_class: 'theta_pers', direction: 'both', target: 'segment', parameter_key: 'personal.segment.metro-yellow',
  },
  {
    name: 'row 9 — activities_dropped',
    problem_class: 'activities_dropped', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 9, parameter_class: 'theta_pers', direction: 'decrease', target: 'segment', parameter_key: 'personal.segment.gr_r8_45.51_-73.56',
  },
  {
    name: 'row 9 — access_lost',
    problem_class: 'access_lost', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 9, parameter_class: 'theta_pers', direction: 'decrease', target: 'segment', parameter_key: 'personal.segment.gr_r8_45.51_-73.56',
  },
  {
    name: 'row 10 — mode_shift_stated',
    problem_class: 'mode_shift_stated', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 10, parameter_class: 'theta_beh', direction: 'both', target: 'segment', parameter_key: 'behaviour.segment.gr_r8_45.51_-73.56',
  },
  {
    name: 'row 10 — habit_changed',
    problem_class: 'habit_changed', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 10, parameter_class: 'theta_beh', direction: 'both', target: 'segment', parameter_key: 'behaviour.segment.gr_r8_45.51_-73.56',
  },
  {
    name: 'row 11 — perceived_unsafe',
    problem_class: 'perceived_unsafe', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 11, parameter_class: 'theta_perc', direction: 'increase', target: 'zone', parameter_key: 'perception.zone.gr_r8_45.51_-73.56',
  },
  {
    name: 'row 11 — perceived_crowding',
    problem_class: 'perceived_crowding', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'metro-orange',
    rule_id: 11, parameter_class: 'theta_perc', direction: 'increase', target: 'zone', parameter_key: 'perception.zone.metro-orange',
  },
  {
    name: 'row 12 — dramaturgical only',
    problem_class: 'none', critical_functional_present: false, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 12, parameter_class: 'theta_perc', direction: 'both', target: 'zone', parameter_key: 'perception.zone.gr_r8_45.51_-73.56',
  },
  {
    name: 'row 12 — unknown problem class falls to the safe default',
    problem_class: 'other', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: null,
    rule_id: 12, parameter_class: 'theta_perc', direction: 'both', target: 'zone', parameter_key: 'perception.zone.aggregate',
  },
  {
    name: 'row 12 — demand_volume without od_pair stays city-level perception',
    problem_class: 'demand_volume', critical_functional_present: true, day_type: 'weekday', od_pair_present: false,
    dramaturgical_mention_shift: false, subject: 'gr_r8_45.51_-73.56',
    rule_id: 12, parameter_class: 'theta_perc', direction: 'both', target: 'zone', parameter_key: 'perception.zone.gr_r8_45.51_-73.56',
  },
]

describe('routing golden table (brief §3, first match wins)', () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      const d = routeAnnotation(g)
      expect(d.rule_id).toBe(g.rule_id)
      expect(d.parameter_class).toBe(g.parameter_class)
      expect(d.direction).toBe(g.direction)
      expect(d.target).toBe(g.target)
      expect(d.parameter_key).toBe(g.parameter_key)
    })
  }

  it('covers all twelve rules plus edge cases', () => {
    expect(new Set(GOLDEN.map((g) => g.rule_id)).size).toBe(12)
    expect(GOLDEN.length).toBe(20)
  })

  it('precedence: vehicle_full beats a shift mention (row 1 before row 8)', () => {
    const d = routeAnnotation(ann({ problem_class: 'vehicle_full', critical_functional_present: true, dramaturgical_mention_shift: true }))
    expect(d.rule_id).toBe(1)
  })

  it('precedence: waiting_excessive beats an event day (row 2 before row 6)', () => {
    const d = routeAnnotation(ann({ problem_class: 'waiting_excessive', critical_functional_present: true, day_type: 'event' }))
    expect(d.rule_id).toBe(2)
  })

  it('precedence: incident beats event day (row 5 before row 6)', () => {
    const d = routeAnnotation(ann({ problem_class: 'incident', critical_functional_present: true, day_type: 'event' }))
    expect(d.rule_id).toBe(5)
  })

  it('precedence: a shift mention beats perceived_crowding (row 8 before row 11)', () => {
    const d = routeAnnotation(ann({ problem_class: 'perceived_crowding', critical_functional_present: true, dramaturgical_mention_shift: true }))
    expect(d.rule_id).toBe(8)
  })

  it('row 6 requires critical_functional.present', () => {
    const d = routeAnnotation(ann({ problem_class: 'none', day_type: 'event', critical_functional_present: false }))
    expect(d.rule_id).toBe(12)
  })

  it('row 7 requires the od_pair', () => {
    const d = routeAnnotation(ann({ problem_class: 'demand_volume', critical_functional_present: true, od_pair_present: false }))
    expect(d.rule_id).toBe(12)
  })
})

describe('I2 — determinism', () => {
  it('routing the same annotation twice yields byte-identical decisions', () => {
    const a = routeAnnotation(ann({ problem_class: 'waiting_excessive', critical_functional_present: true }))
    const b = routeAnnotation(ann({ problem_class: 'waiting_excessive', critical_functional_present: true }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
