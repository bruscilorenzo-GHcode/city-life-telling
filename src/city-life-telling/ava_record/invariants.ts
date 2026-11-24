/** AVA Story Record — record-level invariants (brief §7).
 *
 *  Structural checks beyond the JSON Schema: I3, I5, I7 and the consent
 *  coherence rules (I4 + geolocation). `consent` issues map to exit code 4
 *  in the CLI and are never swallowed; the rest maps to exit code 3. */

import type { StoryRecord } from './types.ts'

export interface InvariantReport {
  /** I3, I5 (sub-city target), I7 — exit code 3 in the CLI. */
  invariant: string[]
  /** I4, geolocation/h3 coherence — exit code 4 (consent) in the CLI. */
  consent: string[]
}

export function checkInvariants(record: StoryRecord): InvariantReport {
  const invariant: string[] = []
  const consent: string[] = []

  const cf = record.channels.critical_functional
  const dramOnly = !cf.present

  // Channel coherence: present ↔ problem_class != none.
  if (dramOnly && cf.problem_class !== 'none') {
    invariant.push(`I3: critical_functional.present = false but problem_class = ${cf.problem_class}`)
  }
  if (!dramOnly && cf.problem_class === 'none') {
    invariant.push(`I3: critical_functional.present = true but problem_class = none`)
  }

  // I3 — a dramaturgical-only record is never calibration-eligible (brief
  // §4 prose + §7 invariant, which tightens the §4 formula). When it lands
  // on row 12 (the safe default) its class must be theta_perc; a row-8
  // shift mention legitimately routes a dram-only story to theta_pers.
  if (dramOnly) {
    if (record.routing.rule_id === 12 && record.routing.parameter_class !== 'theta_perc') {
      invariant.push(`I3: dramaturgical-only record must route to theta_perc, got ${record.routing.parameter_class}`)
    }
    if (record.routing.calibration_eligible) {
      invariant.push('I3: dramaturgical-only record must have calibration_eligible = false')
    }
  }

  // I5 — city granularity: space.h3 must be null and, with no zone_id, no
  // sub-city target is allowed.
  if (record.consent.granularity === 'city') {
    if (record.space.h3 !== null) consent.push('I5: granularity city requires space.h3 = null')
    if (record.space.zone_id === null && record.routing.target !== 'zone') {
      invariant.push(`I5: city granularity without zone_id cannot target ${record.routing.target}`)
    }
  }

  // I4 — consent denied: eligible must be false. A record that claims
  // eligibility despite denied consent is a consent violation, never a
  // warning.
  if (record.consent.calibration_use === 'denied' && record.routing.calibration_eligible) {
    consent.push('I4: calibration_use denied but calibration_eligible = true')
  }

  // Geolocation consent: no H3 cell without geolocation consent.
  if (record.consent.geolocation === false && record.space.h3 !== null) {
    consent.push('consent: geolocation denied but space.h3 present')
  }

  // I7 — the rule that never bends.
  const weak = record.routing.trust_level === 'D' || record.routing.trust_level === 'E'
  if (weak && record.routing.override === true) {
    invariant.push(`I7: trust_level ${record.routing.trust_level} may never set override = true`)
  }

  return { invariant, consent }
}
