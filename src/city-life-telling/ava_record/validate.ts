/** AVA Story Record — minimal JSON Schema 2020-12 validator.
 *
 *  Hand-rolled subset covering every keyword the record schema uses —
 *  $schema/$id/$ref-less documents with: type (string or array), const,
 *  enum, required, properties, additionalProperties (false), items,
 *  pattern, format (uuid | date-time), minimum, maximum, exclusiveMinimum,
 *  minLength, maxLength. No dependencies: the same validator runs in the
 *  browser, in Vitest and in the CLI.
 *
 *  Used by the CLI and the tests against the *authoritative* schema file
 *  (`schemas/ava-story-record-1.0.json`); the browser-safe typed validator
 *  in `types.ts` mirrors it and cross-check tests keep the two in sync. */

export interface SchemaIssue {
  path: string
  message: string
}

export interface SchemaCheckResult {
  ok: boolean
  errors: SchemaIssue[]
}

type SchemaDict = Record<string, unknown>
type JsonDict = Record<string, unknown>

const isDict = (v: unknown): v is JsonDict => typeof v === 'object' && v !== null && !Array.isArray(v)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return isDict(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && !Number.isNaN(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return false
  }
}

function checkFormat(value: string, format: unknown): boolean {
  if (format === 'uuid') return UUID_RE.test(value)
  if (format === 'date-time') return DATE_TIME_RE.test(value) && !Number.isNaN(Date.parse(value))
  return true // unknown formats pass (2020-12: format is annotation-only)
}

/** Validate `value` against `schema` (the subset above). Pure. */
export function validateAgainstSchema(value: unknown, schema: unknown, root: unknown = schema): SchemaCheckResult {
  const errors: SchemaIssue[] = []
  walk(value, schema, root, '$', errors)
  return { ok: errors.length === 0, errors }
}

function push(errors: SchemaIssue[], path: string, message: string): void {
  if (errors.length < 100) errors.push({ path, message })
}

function walk(value: unknown, schema: unknown, root: unknown, path: string, errors: SchemaIssue[]): void {
  if (schema === true || schema === undefined) return
  if (schema === false) {
    push(errors, path, 'schema forbids any value')
    return
  }
  if (!isDict(schema)) {
    push(errors, path, 'invalid schema node')
    return
  }

  // $ref (JSON pointer into the root document) — reserved for composition.
  const ref = schema.$ref
  if (typeof ref === 'string') {
    const resolved = resolveRef(root, ref)
    if (resolved === undefined) {
      push(errors, path, `unresolvable $ref ${ref}`)
      return
    }
    walk(value, resolved, root, path, errors)
    return
  }

  const types = Array.isArray(schema.type) ? schema.type : schema.type !== undefined ? [schema.type] : null
  if (types && !types.some((t) => typeof t === 'string' && typeMatches(value, t))) {
    push(errors, path, `expected type ${JSON.stringify(schema.type)}`)
    return
  }

  if ('const' in schema) {
    const expected = canonicalKey(schema.const)
    if (canonicalKey(value) !== expected) push(errors, path, `expected const ${JSON.stringify(schema.const)}`)
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((option) => canonicalKey(option) === canonicalKey(value))) {
    push(errors, path, `value not in enum ${JSON.stringify(schema.enum)}`)
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      push(errors, path, `shorter than minLength ${schema.minLength}`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      push(errors, path, `longer than maxLength ${schema.maxLength}`)
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      push(errors, path, `does not match pattern ${schema.pattern}`)
    }
    if ('format' in schema && !checkFormat(value, schema.format)) {
      push(errors, path, `does not satisfy format ${String(schema.format)}`)
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) push(errors, path, `less than minimum ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) push(errors, path, `greater than maximum ${schema.maximum}`)
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      push(errors, path, `not above exclusiveMinimum ${schema.exclusiveMinimum}`)
    }
  }

  if (Array.isArray(value) && isDict(schema.items)) {
    value.forEach((item, i) => walk(item, schema.items, root, `${path}[${i}]`, errors))
  }

  if (isDict(value) && isDict(schema.properties)) {
    const props = schema.properties as SchemaDict
    for (const [key, sub] of Object.entries(props)) {
      if (value[key] !== undefined) walk(value[key], sub, root, `${path}.${key}`, errors)
    }
    if (Array.isArray(schema.required)) {
      for (const required of schema.required) {
        if (typeof required === 'string' && value[required] === undefined) {
          push(errors, `${path}.${required}`, 'required field is missing')
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) push(errors, `${path}.${key}`, 'additional property not allowed')
      }
    }
  }
}

/** Canonical form for equality of const/enum members. */
function canonicalKey(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalKey).join(',') + ']'
  const obj = v as JsonDict
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonicalKey(obj[k])).join(',') + '}'
}

function resolveRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#')) return undefined
  const pointer = ref.slice(1)
  if (pointer === '' || pointer === '/') return root
  let current: unknown = root
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isDict(current)) return undefined
    current = current[key]
  }
  return current
}
