import { accountRequest } from './account'

export interface Person {
  userId: string
  displayName: string
  avatarUrl: string | null
}

export interface Friend extends Person {
  presence: {
    title: string
    game: string
    hosting: boolean
    /** Only for a public game. */
    roomCode: string | null
  } | null
  /** What you let this friend use in your games, beyond the controller. */
  permissions: Permissions
}

export interface Permissions {
  keyboard: boolean
  mouse: boolean
}

export interface FriendLists {
  friends: Friend[]
  incoming: Person[]
  outgoing: Person[]
}

async function lists(response: Response): Promise<FriendLists> {
  if (!response.ok) throw new Error(`Friends request failed with HTTP ${response.status}`)
  return response.json() as Promise<FriendLists>
}

export async function fetchFriends(): Promise<FriendLists> {
  return lists(await fetch('/api/friends'))
}

/** Asks someone, or accepts their request when they asked first. */
export async function askFriend(userId: string): Promise<FriendLists> {
  return lists(await accountRequest('/api/friends', 'POST', { userId }))
}

/** Declines, cancels or ends, whichever applies. */
export async function dropFriend(userId: string): Promise<FriendLists> {
  return lists(await accountRequest(`/api/friends/${encodeURIComponent(userId)}`, 'DELETE'))
}

/** What this friend may use from the start in the games you host. */
export async function setPermissions(
  userId: string,
  permissions: Permissions,
): Promise<FriendLists> {
  return lists(
    await accountRequest(
      `/api/friends/${encodeURIComponent(userId)}/permissions`,
      'PUT',
      permissions,
    ),
  )
}
