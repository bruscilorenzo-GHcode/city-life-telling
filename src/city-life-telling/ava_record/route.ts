/** AVA Story Record — deterministic routing (brief §3).
 *
 *  Pure lookup over typed annotations: the twelve-row table is evaluated
 *  top to bottom, first match wins, and the firing row is recorded in
 *  `routing.rule_id`. No network, no model: same annotation ⇒ same
 *  decision, byte-identical (I2).
 *
 *  The annotation is the *typed* output of the annotator (`jev`): the raw
 *  text never reaches this module — textual mentions (shift/appointment)
 *  are resolved upstream by the emit path into the boolean
 *  `dramaturgical_mention_shift`. */

import type { Direction, ParameterClass, ProblemClass, RouteTarget } from './types.ts'

export interface RoutingAnnotation {
  problem_class: ProblemClass
  /** channels.critical_functional.present */
  critical_functional_present: boolean
  day_type: 'weekday' | 'weekend' | 'event' | 'holiday'
  /** space.od_pair present? */
  od_pair_present: boolean
  /** the dramaturgical channel mentions a shift or a fixed appointment */
  dramaturgical_mention_shift: boolean
  /** stable subject id (line, stop, cell…) for the parameter key */
  subject: string | null
}

export interface RouteDecision {
  parameter_class: ParameterClass
  parameter_key: string
  direction: Direction
  target: RouteTarget
  rule_id: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
}

/** Human-readable prefixes for parameter keys (stable, auditable). */
const KEY_PREFIX: Record<ParameterClass, string> = {
  theta_OD: 'demand',
  theta_cap: 'capacity',
  theta_evt: 'event',
  theta_beh: 'behaviour',
  theta_pers: 'personal',
  theta_perc: 'perception',
}

function key(cls: ParameterClass, target: RouteTarget, subject: string | null): string {
  return `${KEY_PREFIX[cls]}.${target}.${subject ?? 'aggregate'}`
}

/** The twelve-row routing table (brief §3), first match wins.
 *  Row 12 is the safe default and deliberately the slowest class. */
export function routeAnnotation(a: RoutingAnnotation): RouteDecision {
  const p = a.problem_class
  // 1
  if (p === 'vehicle_full') {
    return { parameter_class: 'theta_cap', parameter_key: key('theta_cap', 'stop', a.subject), direction: 'decrease', target: 'stop', rule_id: 1 }
  }
  // 2
  if (p === 'boarding_denied' || p === 'waiting_excessive') {
    return { parameter_class: 'theta_cap', parameter_key: key('theta_cap', 'stop', a.subject), direction: 'decrease', target: 'stop', rule_id: 2 }
  }
  // 3
  if (p === 'infrastructure_condition') {
    return { parameter_class: 'theta_cap', parameter_key: key('theta_cap', 'facility', a.subject), direction: 'decrease', target: 'facility', rule_id: 3 }
  }
  // 4
  if (p === 'bunching' || p === 'punctuality') {
    return { parameter_class: 'theta_cap', parameter_key: key('theta_cap', 'link', a.subject), direction: 'decrease', target: 'link', rule_id: 4 }
  }
  // 5
  if (p === 'incident' || p === 'works') {
    return { parameter_class: 'theta_evt', parameter_key: key('theta_evt', 'link', a.subject), direction: 'decrease', target: 'link', rule_id: 5 }
  }
  // 6
  if (a.day_type === 'event' && a.critical_functional_present) {
    return { parameter_class: 'theta_evt', parameter_key: key('theta_evt', 'zone', a.subject), direction: 'increase', target: 'zone', rule_id: 6 }
  }
  // 7
  if (p === 'demand_volume' && a.od_pair_present) {
    return { parameter_class: 'theta_OD', parameter_key: key('theta_OD', 'od_pair', a.subject), direction: 'increase', target: 'od_pair', rule_id: 7 }
  }
  // 8
  if (a.dramaturgical_mention_shift) {
    return { parameter_class: 'theta_pers', parameter_key: key('theta_pers', 'segment', a.subject), direction: 'both', target: 'segment', rule_id: 8 }
  }
  // 9
  if (p === 'activities_dropped' || p === 'access_lost') {
    return { parameter_class: 'theta_pers', parameter_key: key('theta_pers', 'segment', a.subject), direction: 'decrease', target: 'segment', rule_id: 9 }
  }
  // 10
  if (p === 'mode_shift_stated' || p === 'habit_changed') {
    return { parameter_class: 'theta_beh', parameter_key: key('theta_beh', 'segment', a.subject), direction: 'both', target: 'segment', rule_id: 10 }
  }
  // 11
  if (p === 'perceived_unsafe' || p === 'perceived_crowding') {
    return { parameter_class: 'theta_perc', parameter_key: key('theta_perc', 'zone', a.subject), direction: 'increase', target: 'zone', rule_id: 11 }
  }
  // 12 — anything else, including dramaturgical only
  return { parameter_class: 'theta_perc', parameter_key: key('theta_perc', 'zone', a.subject), direction: 'both', target: 'zone', rule_id: 12 }
}
