#!/usr/bin/env node
/** ava-record — CLI for the AVA Story Record v1.0 (brief §8).
 *
 *  Subcommands:
 *
 *    ava-record emit    --annotation ann.json [--out records.jsonl]
 *    ava-record validate <records.jsonl> [more.jsonl…]
 *    ava-record route   --annotation ann.json
 *    ava-record weight  --record r.json --now <iso-date-time>
 *    ava-record square  --record r.json --evidence ev.json
 *
 *  Exit codes (brief §8):
 *    0  ok
 *    2  schema violation (also: malformed input files / usage)
 *    3  invariant violation
 *    4  consent violation — never swallowed: a consent violation is a
 *       stop, not a warning (precedence 4 > 2 > 3).
 *
 *  Runs on Node ≥ 26 with type stripping (`npm run ava-record`). No
 *  network, no model calls: pure functions over typed JSON files. JSONL
 *  output is byte-identical for identical inputs (I2). */

import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { emitRecord, routingAnnotationFrom, type EmitInput } from './emit.ts'
import { checkInvariants } from './invariants.ts'
import { routeAnnotation, type RoutingAnnotation } from './route.ts'
import { dialogBlock, type SquareEvidence } from './square.ts'
import { recordWeight, checkClock, checkOverride } from './weight.ts'
import { validateAgainstSchema } from './validate.ts'
import { validateStoryRecord, type StoryRecord } from './types.ts'

const here = dirname(fileURLToPath(import.meta.url))
/** Authoritative schema, byte-identical copy of docs/integration/. */
const SCHEMA_PATH = resolve(here, '../../../schemas/ava-story-record-1.0.json')

const EXIT_OK = 0
const EXIT_SCHEMA = 2
const EXIT_INVARIANT = 3
const EXIT_CONSENT = 4

function usage(): string {
  return [
    'usage:',
    '  ava-record emit    --annotation ann.json [--out records.jsonl]',
    '  ava-record validate <records.jsonl> [more.jsonl…]',
    '  ava-record route   --annotation ann.json',
    '  ava-record weight  --record r.json --now <iso>',
    '  ava-record square  --record r.json --evidence ev.json',
  ].join('\n')
}

function failUsage(): never {
  console.error(usage())
  process.exit(EXIT_SCHEMA)
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`cannot read JSON file ${path}: ${(error as Error).message}`)
    process.exit(EXIT_SCHEMA)
  }
}

function loadSchema(): unknown {
  if (!existsSync(SCHEMA_PATH)) {
    console.error(`schema not found: ${SCHEMA_PATH}`)
    process.exit(EXIT_SCHEMA)
  }
  return readJson(SCHEMA_PATH)
}

function isEmitInput(v: unknown): v is EmitInput {
  return typeof v === 'object' && v !== null && 'source_kind' in v && 'signal' in v
}

function isRoutingAnnotation(v: unknown): v is RoutingAnnotation {
  return typeof v === 'object' && v !== null && 'problem_class' in v
}

function main(): number {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] ?? null : null
  }

  switch (command) {
    case 'emit': {
      const annotationPath = flag('--annotation')
      if (!annotationPath) failUsage()
      const out = flag('--out')
      const annotation = readJson(annotationPath!)
      if (!isEmitInput(annotation)) {
        console.error('the annotation file must be an EmitInput (see src/city-life-telling/ava_record/emit.ts)')
        return EXIT_SCHEMA
      }
      const result = emitRecord(annotation)
      if (!result.ok) {
        for (const e of result.errors) console.error(`${result.code}: ${e}`)
        return result.code === 'consent' ? EXIT_CONSENT : result.code === 'invariant' ? EXIT_INVARIANT : EXIT_SCHEMA
      }
      // Belt and braces: re-validate the emitted record against the
      // authoritative schema file (generic validator, not the typed one).
      const check = validateAgainstSchema(result.record, loadSchema())
      if (!check.ok) {
        for (const e of check.errors) console.error(`schema: ${e.path}: ${e.message}`)
        return EXIT_SCHEMA
      }
      const line = result.jsonl
      if (out) {
        appendFileSync(out, line + '\n', 'utf8')
        console.log(`appended 1 record to ${out}`)
      } else {
        process.stdout.write(line + '\n')
      }
      return EXIT_OK
    }

    case 'validate': {
      const files = argv.slice(1).filter((a) => !a.startsWith('--'))
      if (files.length === 0) failUsage()
      const schema = loadSchema()
      let exit = EXIT_OK
      let total = 0
      let bad = 0
      for (const file of files) {
        let raw: string
        try {
          raw = readFileSync(file, 'utf8')
        } catch (error) {
          console.error(`cannot read ${file}: ${(error as Error).message}`)
          exit = exit === EXIT_CONSENT ? EXIT_CONSENT : EXIT_SCHEMA
          continue
        }
        const lines = raw.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!.trim()
          if (line === '') continue
          total += 1
          const label = `${file}:${i + 1}`
          let parsed: unknown
          try {
            parsed = JSON.parse(line)
          } catch (error) {
            bad += 1
            console.error(`${label}: schema: not valid JSON (${(error as Error).message})`)
            exit = exit === EXIT_CONSENT ? EXIT_CONSENT : EXIT_SCHEMA
            continue
          }
          // Authoritative schema check (generic validator).
          const schemaCheck = validateAgainstSchema(parsed, schema)
          // Cross-check with the typed validator — must agree.
          const typedCheck = validateStoryRecord(parsed)
          if (!schemaCheck.ok || !typedCheck.ok) {
            bad += 1
            for (const e of schemaCheck.errors) console.error(`${label}: schema: ${e.path}: ${e.message}`)
            for (const e of typedCheck.errors) console.error(`${label}: typed: ${e.path}: ${e.message}`)
            exit = exit === EXIT_CONSENT ? EXIT_CONSENT : EXIT_SCHEMA
            continue
          }
          const record = parsed as StoryRecord
          const invariants = checkInvariants(record)
          if (invariants.consent.length > 0) {
            bad += 1
            for (const e of invariants.consent) console.error(`${label}: consent: ${e}`)
            exit = EXIT_CONSENT
            continue
          }
          if (invariants.invariant.length > 0) {
            bad += 1
            for (const e of invariants.invariant) console.error(`${label}: invariant: ${e}`)
            exit = exit === EXIT_CONSENT ? EXIT_CONSENT : EXIT_INVARIANT
            continue
          }
          console.log(`${label}: ok (${record.routing.parameter_class}, rule ${record.routing.rule_id}, eligible=${record.routing.calibration_eligible})`)
        }
      }
      console.error(`${total - bad}/${total} records valid`)
      return exit
    }

    case 'route': {
      const annotationPath = flag('--annotation')
      if (!annotationPath) failUsage()
      const annotation = readJson(annotationPath!)
      let decision
      if (isRoutingAnnotation(annotation)) decision = routeAnnotation(annotation)
      else if (isEmitInput(annotation)) decision = routeAnnotation(routingAnnotationFrom(annotation))
      else {
        console.error('the annotation file must be a RoutingAnnotation or an EmitInput')
        return EXIT_SCHEMA
      }
      process.stdout.write(JSON.stringify(decision, null, 2) + '\n')
      return EXIT_OK
    }

    case 'weight': {
      const recordPath = flag('--record')
      if (!recordPath) failUsage()
      const record = readJson(recordPath!) as StoryRecord
      const now = flag('--now') ?? record.created_at
      const typed = validateStoryRecord(record)
      if (!typed.ok) {
        for (const e of typed.errors) console.error(`typed: ${e.path}: ${e.message}`)
        return EXIT_SCHEMA
      }
      const breakdown = recordWeight(record, now)
      const clock = checkClock(record, record.observation.clock)
      const override = checkOverride(record)
      process.stdout.write(JSON.stringify({ breakdown, clock, override }, null, 2) + '\n')
      return EXIT_OK
    }

    case 'square': {
      const recordPath = flag('--record')
      const evidencePath = flag('--evidence')
      if (!recordPath || !evidencePath) failUsage()
      const record = readJson(recordPath!) as StoryRecord
      const evidence = readJson(evidencePath!) as SquareEvidence
      const typed = validateStoryRecord(record)
      if (!typed.ok) {
        for (const e of typed.errors) console.error(`typed: ${e.path}: ${e.message}`)
        return EXIT_SCHEMA
      }
      if (typeof evidence !== 'object' || evidence === null
        || typeof evidence.instrumented !== 'boolean' || typeof evidence.reported !== 'boolean') {
        console.error('the evidence file must be { instrumented: boolean, reported: boolean, model: { run_id, baseline_id, expected, observed, tolerance } | null }')
        return EXIT_SCHEMA
      }
      const block = dialogBlock(evidence)
      process.stdout.write(JSON.stringify(block, null, 2) + '\n')
      return EXIT_OK
    }

    default:
      failUsage()
  }
}

process.exit(main())
