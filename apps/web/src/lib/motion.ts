/**
 * Motion from the guest's side: the gyroscope and accelerometer of a PlayStation or
 * Nintendo controller read over WebHID (Chrome and Edge), or of the phone itself while the
 * touch controller plays. Values are turned into a DualShock 4's units, which the host
 * passes to its virtual DualShock 4.
 */

import { vendorProduct } from './controllers'

/** DualShock 4 units: about 16 per degree per second, 8192 per g. */
const DS4_PER_DPS = 16.4
const DS4_PER_G = 8192
const STANDARD_GRAVITY = 9.81
/** A reading older than this is stale: the controller stopped reporting. */
const FRESH_MS = 100

export interface Motion {
  gyro: [number, number, number]
  accel: [number, number, number]
  at: number
}

type HidDevice = {
  vendorId: number
  productId: number
  productName: string
  opened: boolean
  open(): Promise<void>
  sendReport(id: number, data: Uint8Array): Promise<void>
  addEventListener(type: 'inputreport', listener: (event: HidReport) => void): void
}
type HidReport = { device: HidDevice; reportId: number; data: DataView }
type Hid = {
  getDevices(): Promise<HidDevice[]>
  requestDevice(options: { filters: { vendorId: number }[] }): Promise<HidDevice[]>
}

const SONY = 0x054c
const NINTENDO = 0x057e
const DUALSENSE = new Set([0x0ce6, 0x0df2])

const readings = new Map<string, Motion>()
let phone: Motion | null = null
const listeners = new Set<() => void>()

export function hidAvailable(): boolean {
  return 'hid' in navigator
}

function hid(): Hid | null {
  return hidAvailable() ? ((navigator as unknown as { hid: Hid }).hid ?? null) : null
}

const key = (vendor: number, product: number) =>
  `${vendor.toString(16).padStart(4, '0')}:${product.toString(16).padStart(4, '0')}`

/** The latest motion for a controller, matched by the vendor and product in its id. */
export function motionFor(gamepad: Gamepad, now: number): Motion | null {
  const ids = vendorProduct(gamepad.id)
  const found = ids ? readings.get(`${ids.vendor}:${ids.product}`) : undefined
  return found && now - found.at < FRESH_MS ? found : null
}

export function phoneMotion(now: number): Motion | null {
  return phone && now - phone.at < FRESH_MS ? phone : null
}

/** The controllers already allowed, reconnected without asking again. */
export async function resumeControllers(): Promise<string[]> {
  const devices = (await hid()?.getDevices()) ?? []
  await Promise.all(devices.map(listen))
  return devices.map((device) => device.productName)
}

/** Asks the browser for a controller; must run from a click. */
export async function connectController(): Promise<string[]> {
  const devices =
    (await hid()?.requestDevice({ filters: [{ vendorId: SONY }, { vendorId: NINTENDO }] })) ?? []
  await Promise.all(devices.map(listen))
  return devices.map((device) => device.productName)
}

export function onMotionChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function listen(device: HidDevice): Promise<void> {
  if (!device.opened) await device.open()
  device.addEventListener('inputreport', onReport)
  if (device.vendorId === NINTENDO) await startNintendoMotion(device)
}

function onReport({ device, reportId, data }: HidReport) {
  const motion = parse(device, reportId, data)
  if (!motion) return
  readings.set(key(device.vendorId, device.productId), motion)
  for (const listener of listeners) listener()
}

function parse(device: HidDevice, reportId: number, data: DataView): Motion | null {
  const at = performance.now()
  const triple = (offset: number, scale: number): [number, number, number] => [
    data.getInt16(offset, true) * scale,
    data.getInt16(offset + 2, true) * scale,
    data.getInt16(offset + 4, true) * scale,
  ]
  if (device.vendorId === SONY) {
    // Offsets after the report id: USB report 1, Bluetooth report 0x11 (DS4) or 0x31.
    const dualSense = DUALSENSE.has(device.productId)
    const base = dualSense ? 15 : 12
    const shift = reportId === 0x01 ? 0 : dualSense ? 1 : 2
    if (data.byteLength < base + shift + 12) return null
    return { gyro: triple(base + shift, 1), accel: triple(base + shift + 6, 1), at }
  }
  if (device.vendorId === NINTENDO && reportId === 0x30 && data.byteLength >= 24) {
    // Full mode: accelerometer then gyroscope, three samples; the first is enough.
    return { accel: triple(12, 2), gyro: triple(18, 1.15), at }
  }
  return null
}

/** Nintendo controllers send motion only once asked: full report mode, sensors on. */
async function startNintendoMotion(device: HidDevice): Promise<void> {
  let packet = 0
  const subcommand = (command: number, argument: number) => {
    const report = new Uint8Array(48)
    report[0] = packet++ & 0x0f
    // A neutral rumble, as the protocol wants one before each subcommand.
    report.set([0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40], 1)
    report[9] = command
    report[10] = argument
    return device.sendReport(0x01, report)
  }
  await subcommand(0x40, 0x01)
  await subcommand(0x03, 0x30)
}

/** The phone's own sensors, for the touch controller. iOS asks once, from a tap. */
export async function startPhoneMotion(): Promise<boolean> {
  type Asking = { requestPermission?: () => Promise<'granted' | 'denied'> }
  const ask = (DeviceMotionEvent as unknown as Asking).requestPermission
  if (ask && (await ask()) !== 'granted') return false
  window.addEventListener('devicemotion', onDeviceMotion)
  return true
}

export function stopPhoneMotion(): void {
  window.removeEventListener('devicemotion', onDeviceMotion)
  phone = null
}

function onDeviceMotion(event: DeviceMotionEvent) {
  const rate = event.rotationRate
  const gravity = event.accelerationIncludingGravity
  if (!rate || !gravity) return
  const g = (value: number | null) => ((value ?? 0) / STANDARD_GRAVITY) * DS4_PER_G
  const dps = (value: number | null) => (value ?? 0) * DS4_PER_DPS
  phone = {
    gyro: [dps(rate.beta), dps(rate.alpha), dps(rate.gamma)],
    accel: [g(gravity.x), g(gravity.y), g(gravity.z)],
    at: performance.now(),
  }
}
