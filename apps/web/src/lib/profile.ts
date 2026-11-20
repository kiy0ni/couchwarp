import { accountRequest } from './account'

export const PROFILE_COLORS = ['coral', 'sky', 'lime', 'amber'] as const
export type ProfileColor = (typeof PROFILE_COLORS)[number]

/** Mirrors `Badge` in `services/edge/src/profiles.ts`. */
export type Badge = 'team' | 'pioneer' | 'host' | 'regular-host' | 'regular' | 'social'

export interface PublicProfile {
  id: string
  displayName: string
  avatarUrl: string | null
  color: ProfileColor | null
  tag: number | null
  memberSince: number
  badges: Badge[]
}

/** Side of the square picture sent: plenty for a round avatar, small enough to store. */
const AVATAR_SIDE = 256
const AVATAR_QUALITY = 0.86

export async function fetchProfile(userId: string): Promise<PublicProfile | null> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}`)
  return response.ok ? ((await response.json()) as PublicProfile) : null
}

export async function updateProfile(patch: {
  displayName?: string
  color?: ProfileColor | null
}): Promise<boolean> {
  return (await accountRequest('/api/me/profile', 'PATCH', patch)).ok
}

/**
 * Sends a picture of one's own: cropped to a square from its middle and redrawn small in
 * the browser, so whatever the file was, a plain JPEG of a few kilobytes leaves.
 */
export async function uploadAvatar(file: File): Promise<boolean> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIDE
  canvas.height = AVATAR_SIDE
  const context = canvas.getContext('2d')
  if (!context) return false
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIDE,
    AVATAR_SIDE,
  )
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', AVATAR_QUALITY),
  )
  if (!blob) return false
  const response = await fetch('/api/me/avatar', {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  })
  return response.ok
}

export async function removeAvatar(): Promise<boolean> {
  return (await accountRequest('/api/me/avatar', 'DELETE')).ok
}
