/** Running totals of the video track, as the browser counts them. */
export interface PacketCounts {
  received: number
  lost: number
}

/**
 * Video packets lost between two readings, in thousandths. Counters can go back when a
 * stream restarts; that reading then counts as clean.
 */
export function lossPermille(before: PacketCounts, after: PacketCounts): number {
  const received = after.received - before.received
  const lost = after.lost - before.lost
  if (received < 0 || lost <= 0) return 0
  return Math.min(1000, Math.round((lost / (received + lost)) * 1000))
}
