import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@couchwarp/protocol'

/** Largest multiple of the alphabet size under 256, to keep the draw unbiased. */
const UNBIASED_LIMIT = 256 - (256 % ROOM_CODE_ALPHABET.length)

export function randomRoomCode(): string {
  let code = ''
  while (code.length < ROOM_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH * 2))) {
      if (byte < UNBIASED_LIMIT && code.length < ROOM_CODE_LENGTH) {
        code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]
      }
    }
  }
  return code
}
