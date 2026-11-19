/**
 * What the web client and the room server exchange about people rather than games:
 * reports and their handling. Only TypeScript speaks it; the host never does.
 */

import { cleanText } from './room'
import { asObject, isInteger } from './validate'

export const REPORT_REASONS = [
  'harassment',
  'hate',
  'sexual',
  'illegal-game',
  'cheating',
  'other',
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const MAX_REPORT_DETAILS = 500

export interface ReportRequest {
  /** The guest reported, or null for the room itself. */
  guestId: number | null
  reason: ReportReason
  details: string
}

export const REPORT_DECISIONS = ['dismissed', 'room-closed', 'account-suspended'] as const
export type ReportDecision = (typeof REPORT_DECISIONS)[number]

export function parseReportRequest(value: unknown): ReportRequest | null {
  const body = asObject(value)
  if (!body) return null
  const { guestId, reason, details } = body
  if (guestId !== null && !isInteger(guestId, 1, 2 ** 32 - 1)) return null
  if (!REPORT_REASONS.includes(reason as ReportReason)) return null
  if (typeof details !== 'string') return null
  return {
    guestId: guestId as number | null,
    reason: reason as ReportReason,
    details: cleanText(details, MAX_REPORT_DETAILS),
  }
}
