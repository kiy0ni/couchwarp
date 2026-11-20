/**
 * Which maker a controller comes from, read from the id browsers give it, so each one is
 * shown with its own button names and Nintendo controllers can follow their letters.
 */

export type Family = 'xbox' | 'playstation' | 'nintendo' | 'generic'

const VENDORS: Record<string, Family> = {
  '045e': 'xbox',
  '054c': 'playstation',
  '057e': 'nintendo',
}

/** Chrome writes "Vendor: 054c Product: 0ce6", Firefox "054c-0ce6-…". */
export function vendorProduct(id: string): { vendor: string; product: string } | null {
  const chrome = id.match(/Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i)
  const firefox = id.match(/^([0-9a-f]{4})-([0-9a-f]{4})-/i)
  const found = chrome ?? firefox
  return found?.[1] && found[2]
    ? { vendor: found[1].toLowerCase(), product: found[2].toLowerCase() }
    : null
}

export function familyOf(id: string): Family {
  const ids = vendorProduct(id)
  if (ids && VENDORS[ids.vendor]) return VENDORS[ids.vendor] as Family
  if (/xbox|xinput/i.test(id)) return 'xbox'
  if (/dualsense|dualshock|playstation|wireless controller/i.test(id)) return 'playstation'
  if (/pro controller|joy-con|nintendo|switch/i.test(id)) return 'nintendo'
  return 'generic'
}

/**
 * The names printed on the four face buttons, in the browser's order: bottom, right,
 * left, top. A Nintendo controller has B at the bottom and A on the right.
 */
export const FACE_LABELS: Record<Family, readonly [string, string, string, string]> = {
  xbox: ['A', 'B', 'X', 'Y'],
  playstation: ['✕', '○', '□', '△'],
  nintendo: ['B', 'A', 'Y', 'X'],
  generic: ['A', 'B', 'X', 'Y'],
}

export const FAMILY_NAMES: Record<Family, string> = {
  xbox: 'Xbox',
  playstation: 'PlayStation',
  nintendo: 'Nintendo Switch',
  generic: '',
}
