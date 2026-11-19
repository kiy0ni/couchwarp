export type Fields = Record<string, unknown>

export function parseObject(text: string): Fields | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null
}

export function asObject(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null
}

export function isInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
