/**
 * Room codes: six characters a guest reads off a screen and types on a phone.
 * Letters and digits that look alike (0 O, 1 I L) are left out.
 */

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6

/** Uppercases and strips spaces and dashes, so "k7m-2qx" reads as "K7M2QX". */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}

export function isRoomCode(code: string): boolean {
  return (
    code.length === ROOM_CODE_LENGTH && [...code].every((char) => ROOM_CODE_ALPHABET.includes(char))
  )
}
