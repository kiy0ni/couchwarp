/**
 * Reports and their handling (notice and action). Anyone in a room, signed in or not,
 * can report the room or one of its guests; the people listed in `ADMIN_USER_IDS`
 * decide, and every decision keeps its reason.
 *
 * - `POST /api/rooms/:code/report`: `{ guestId, reason, details }`
 * - `GET  /api/admin/reports?state=open|decided`
 * - `POST /api/admin/reports/:id`: `{ decision, note, suspendDays? }`
 */

import {
  parseReportRequest,
  REPORT_DECISIONS,
  type ReportDecision,
  type RoomState,
} from '@couchwarp/protocol'
import { currentUser, type User } from './auth/sessions'
import { fromOurPages, json, problem } from './http'

/** Reports one network address may send per hour, across all rooms. */
const REPORTS_PER_HOUR = 5
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MAX_SUSPEND_DAYS = 365
const MAX_NOTE_LENGTH = 1000

/** What the room tells about itself and one guest, for a report. */
export interface RoomFacts {
  open: boolean
  title: string
  member: { name: string; userId: string | null } | null
}

export function isAdmin(env: Env, user: User | null): boolean {
  if (!user) return false
  return (env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .includes(user.id)
}

export async function report(
  request: Request,
  env: Env,
  code: string,
  addressHash: string,
): Promise<Response> {
  if (request.method !== 'POST') return problem(405, 'method-not-allowed')
  if (!fromOurPages(request, env)) return problem(403, 'cross-site')
  const body = parseReportRequest(await request.json().catch(() => null))
  if (!body) return problem(400, 'invalid-report')

  const now = Date.now()
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM reports WHERE reporter_hash = ? AND created_at > ?',
  )
    .bind(addressHash, now - HOUR_MS)
    .first<number>('count')
  if ((recent ?? 0) >= REPORTS_PER_HOUR) return problem(429, 'too-many-reports')

  const facts = await roomFacts(env, code, body.guestId)
  if (!facts.open) return problem(404, 'room-not-found')
  if (body.guestId !== null && !facts.member) return problem(404, 'unknown-guest')

  const reporter = await currentUser(request, env.DB)
  await env.DB.prepare(
    `INSERT INTO reports (id, room_code, room_title, reporter_user_id, reporter_hash, target_name,
       target_user_id, reason, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      code,
      facts.title,
      reporter?.id ?? null,
      addressHash,
      facts.member?.name ?? null,
      facts.member?.userId ?? null,
      body.reason,
      body.details,
      now,
    )
    .run()
  return json({ received: true }, 201)
}

async function roomFacts(env: Env, code: string, guestId: number | null): Promise<RoomFacts> {
  const query = guestId === null ? '' : `?guestId=${guestId}`
  const response = await env.ROOMS.getByName(code).fetch(`https://room/${code}/facts${query}`)
  return response.json<RoomFacts>()
}

/** The facts a room gives about itself, from its state. */
export function factsFrom(state: RoomState | null, guestId: number | null): RoomFacts {
  if (!state) return { open: false, title: '', member: null }
  const member = guestId === null ? undefined : state.members.find((m) => m.id === guestId)
  return {
    open: true,
    title: state.settings.title || state.code,
    member: member ? { name: member.name, userId: member.userId } : null,
  }
}

interface ReportRow {
  id: string
  room_code: string
  room_title: string
  reporter_user_id: string | null
  target_name: string | null
  target_user_id: string | null
  reason: string
  details: string
  created_at: number
  decision: string | null
  decision_note: string | null
  decided_by: string | null
  decided_at: number | null
}

/** Handles `/api/admin/*` for admins, or returns null for other paths. */
export async function handleAdmin(request: Request, env: Env): Promise<Response | null> {
  const { pathname, searchParams } = new URL(request.url)
  if (!pathname.startsWith('/api/admin/')) return null
  const user = await currentUser(request, env.DB)
  if (!isAdmin(env, user) || !user) return problem(403, 'admins-only')

  if (pathname === '/api/admin/reports' && request.method === 'GET') {
    const decided = searchParams.get('state') === 'decided'
    const { results } = await env.DB.prepare(
      `SELECT * FROM reports WHERE decided_at IS ${decided ? 'NOT NULL' : 'NULL'}
       ORDER BY created_at ${decided ? 'DESC' : 'ASC'} LIMIT 200`,
    ).all<ReportRow>()
    return json({ reports: results.map(publicReport) })
  }

  const decide = pathname.match(/^\/api\/admin\/reports\/([0-9a-f-]{36})$/)
  if (decide?.[1] && request.method === 'POST') {
    if (!fromOurPages(request, env)) return problem(403, 'cross-site')
    return decideReport(request, env, user, decide[1])
  }
  return problem(404, 'not-found')
}

async function decideReport(
  request: Request,
  env: Env,
  admin: User,
  id: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    decision?: unknown
    note?: unknown
    suspendDays?: unknown
  } | null
  const decision = body?.decision as ReportDecision
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : ''
  if (!REPORT_DECISIONS.includes(decision)) return problem(400, 'invalid-decision')
  // The reason is what the person concerned is entitled to know.
  if (!note) return problem(400, 'reason-required')

  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<ReportRow>()
  if (!row) return problem(404, 'not-found')
  if (row.decided_at !== null) return problem(409, 'already-decided')

  const now = Date.now()
  if (decision === 'room-closed') {
    await env.ROOMS.getByName(row.room_code).fetch(`https://room/${row.room_code}/admin-close`, {
      method: 'POST',
    })
  }
  if (decision === 'account-suspended') {
    const days = Number(body?.suspendDays)
    if (!row.target_user_id) return problem(400, 'no-account-to-suspend')
    if (!Number.isInteger(days) || days < 1 || days > MAX_SUSPEND_DAYS) {
      return problem(400, 'invalid-duration')
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET banned_until = ? WHERE id = ?').bind(
        now + days * DAY_MS,
        row.target_user_id,
      ),
      // Signed out everywhere at once.
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.target_user_id),
    ])
  }
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE reports SET decision = ?, decision_note = ?, decided_by = ?, decided_at = ? WHERE id = ?',
    ).bind(decision, note, admin.id, now, id),
    env.DB.prepare(
      'INSERT INTO moderation_log (room_code, actor, action, target_name, target_user_id, at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      row.room_code,
      `admin:${admin.displayName}`,
      decision,
      row.target_name ?? '(room)',
      row.target_user_id,
      now,
    ),
  ])
  return json({ decided: true })
}

function publicReport(row: ReportRow) {
  return {
    id: row.id,
    roomCode: row.room_code,
    roomTitle: row.room_title,
    signedInReporter: row.reporter_user_id !== null,
    targetName: row.target_name,
    targetHasAccount: row.target_user_id !== null,
    reason: row.reason,
    details: row.details,
    createdAt: row.created_at,
    decision: row.decision,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at,
  }
}
