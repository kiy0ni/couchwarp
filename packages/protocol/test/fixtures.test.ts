import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  encodeInput,
  type InputPacket,
  nextSeq,
  parseConsoleToEdge,
  parseEdgeToGuest,
  parseGuestToEdge,
  parseHostControl,
  parseHostToEdge,
} from '../src'

interface Example {
  name: string
  packet: Record<string, unknown>
  hex: string
}

function fixture(name: string): Record<string, unknown[]> {
  const path = join(import.meta.dirname, '../../../fixtures/protocol', name)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('input packets', () => {
  const input = fixture('input.json')

  it.each(input.gamepad as Example[])('encodes the gamepad example "$name"', (example) => {
    const packet = { kind: 'gamepad', ...example.packet } as InputPacket
    expect(toHex(encodeInput(packet))).toBe(example.hex)
  })

  it.each(input.keyboard as Example[])('encodes the keyboard example "$name"', (example) => {
    const packet = { kind: 'keyboard', ...example.packet } as InputPacket
    expect(toHex(encodeInput(packet))).toBe(example.hex)
  })

  it.each(input.mouse as Example[])('encodes the mouse example "$name"', (example) => {
    const packet = { kind: 'mouse', ...example.packet } as InputPacket
    expect(toHex(encodeInput(packet))).toBe(example.hex)
  })

  it.each(input.motion as Example[])('encodes the motion example "$name"', (example) => {
    const packet = { kind: 'motion', ...example.packet } as InputPacket
    expect(toHex(encodeInput(packet))).toBe(example.hex)
  })

  it('caps mouse movement at 16 bits', () => {
    const bytes = encodeInput({
      kind: 'mouse',
      seq: 1,
      buttons: 0,
      dx: 99999,
      dy: -99999,
      wheel: 0,
    })
    const view = new DataView(bytes.buffer)
    expect([view.getInt16(4, true), view.getInt16(6, true)]).toEqual([32767, -32768])
  })

  it('drops keys past the limit instead of writing an invalid packet', () => {
    const bytes = encodeInput({ kind: 'keyboard', seq: 1, keys: Array(40).fill(4) })
    expect(bytes[3]).toBe(32)
    expect(bytes.length).toBe(4 + 32)
  })

  it('wraps the sequence counter at 16 bits', () => {
    expect(nextSeq(65535)).toBe(0)
    expect(nextSeq(41)).toBe(42)
  })
})

describe('signal messages', () => {
  const signal = fixture('signal.json')

  it.each(signal.edgeToGuest as object[])('parses edge to guest %j', (message) => {
    expect(parseEdgeToGuest(JSON.stringify(message))).toEqual(message)
  })

  it.each(signal.guestToEdge as object[])('parses guest to edge %j', (message) => {
    expect(parseGuestToEdge(JSON.stringify(message))).toEqual(message)
  })

  it.each(signal.hostToEdge as object[])('parses host to edge %j', (message) => {
    expect(parseHostToEdge(JSON.stringify(message))).toEqual(message)
  })

  it.each(signal.consoleToEdge as object[])('parses console to edge %j', (message) => {
    expect(parseConsoleToEdge(JSON.stringify(message))).toEqual(message)
  })

  it('rejects malformed messages', () => {
    expect(parseGuestToEdge('not json')).toBeNull()
    expect(parseGuestToEdge('[]')).toBeNull()
    expect(parseGuestToEdge('{"type":"signal","payload":{"kind":"offer"}}')).toBeNull()
    expect(
      parseHostToEdge('{"type":"signal","to":-1,"payload":{"kind":"answer","sdp":""}}'),
    ).toBeNull()
    expect(parseEdgeToGuest('{"type":"rejected","reason":"because"}')).toBeNull()
    expect(
      parseEdgeToGuest('{"type":"welcome","guestId":1,"iceServers":[{"urls":"stun:x"}]}'),
    ).toBeNull()
  })

  it('rejects an oversized SDP', () => {
    const sdp = 'a'.repeat(64 * 1024 + 1)
    expect(
      parseGuestToEdge(JSON.stringify({ type: 'signal', payload: { kind: 'offer', sdp } })),
    ).toBeNull()
  })
})

describe('control messages', () => {
  const control = fixture('control.json')

  it.each(control.hostToGuest as object[])('parses host to guest %j', (message) => {
    expect(parseHostControl(JSON.stringify(message))).toEqual(message)
  })

  it('rejects a slot outside 1 to 8', () => {
    expect(parseHostControl('{"type":"slot","pad":0,"slot":9}')).toBeNull()
  })
})
