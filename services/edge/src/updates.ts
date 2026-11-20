/**
 * Desktop app updates and downloads, served from the app's GitHub releases.
 *
 * The release workflow attaches the installers and `latest.json`, the manifest the app's
 * updater reads. The repository may be private, so the app never asks GitHub itself: this
 * server reads the latest published release (with `RELEASES_TOKEN` when set) and hands out
 * links of its own, which redirect to GitHub's short-lived download addresses.
 *
 * - `GET /api/updates/latest.json`: the manifest, its links pointing here; 204 without one.
 * - `GET /api/updates/assets/:id`: redirects to one file of the latest release.
 */

import { redirect } from './http'

const GITHUB_API = 'https://api.github.com'
/** How long a look at the latest release is reused, so GitHub sees a few calls an hour. */
const FRESH_MS = 5 * 60_000

interface Asset {
  id: number
  name: string
}

interface Release {
  tag: string
  assets: Asset[]
}

/** What `latest.json` holds, as tauri-action writes it and the updater reads it. */
interface Manifest {
  version: string
  notes?: string
  pub_date?: string
  platforms: Record<string, { signature: string; url: string }>
}

let remembered: { at: number; release: Release | null } | null = null

/** Drops the remembered release, so the next request asks GitHub again. */
export function forgetRelease(): void {
  remembered = null
}

function githubHeaders(env: Env, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'couchwarp-edge',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (env.RELEASES_TOKEN) headers.Authorization = `Bearer ${env.RELEASES_TOKEN}`
  return headers
}

/** The latest published release, or null when there is none or GitHub cannot be read. */
async function latestRelease(env: Env, now: number): Promise<Release | null> {
  if (!env.RELEASES_REPO) return null
  if (remembered && now - remembered.at < FRESH_MS) return remembered.release
  let release: Release | null = null
  try {
    const response = await fetch(`${GITHUB_API}/repos/${env.RELEASES_REPO}/releases/latest`, {
      headers: githubHeaders(env, 'application/vnd.github+json'),
    })
    if (response.ok) {
      const body = await response.json<{ tag_name: string; assets: Asset[] }>()
      release = { tag: body.tag_name, assets: body.assets.map(({ id, name }) => ({ id, name })) }
    }
  } catch {
    // Unreachable counts as no release; the app simply finds no update this time.
  }
  remembered = { at: now, release }
  return release
}

/** The short-lived address GitHub gives for one file, valid for a few minutes. */
async function assetLocation(env: Env, id: number): Promise<string | null> {
  const response = await fetch(`${GITHUB_API}/repos/${env.RELEASES_REPO}/releases/assets/${id}`, {
    headers: githubHeaders(env, 'application/octet-stream'),
    redirect: 'manual',
  })
  return response.status >= 300 && response.status < 400 ? response.headers.get('Location') : null
}

function assetLink(origin: string, asset: Asset): string {
  return `${origin}/api/updates/assets/${asset.id}`
}

/** The release's manifest, each platform's file linked through this server. */
async function manifest(env: Env, origin: string, now: number): Promise<Manifest | null> {
  const release = await latestRelease(env, now)
  const file = release?.assets.find((asset) => asset.name === 'latest.json')
  if (!release || !file) return null
  const location = await assetLocation(env, file.id)
  if (!location) return null
  const response = await fetch(location)
  if (!response.ok) return null
  const original = await response.json<Manifest>()
  const platforms: Manifest['platforms'] = {}
  for (const [platform, entry] of Object.entries(original.platforms)) {
    const name = decodeURIComponent(entry.url.split('/').pop() ?? '')
    const asset = release.assets.find((candidate) => candidate.name === name)
    if (asset) platforms[platform] = { signature: entry.signature, url: assetLink(origin, asset) }
  }
  return { ...original, platforms }
}

/** Installer links for the Host page, from the latest release, or null when it has none. */
export async function releaseDownloads(
  env: Env,
  origin: string,
  now: number,
): Promise<{ mac: string | null; windows: string | null }> {
  const release = await latestRelease(env, now)
  const find = (suffix: string) => {
    const asset = release?.assets.find((candidate) => candidate.name.endsWith(suffix))
    return asset ? assetLink(origin, asset) : null
  }
  return { mac: find('.dmg'), windows: find('-setup.exe') }
}

export async function handleUpdates(
  request: Request,
  env: Env,
  origin: string,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith('/api/updates/') || request.method !== 'GET') return null
  const now = Date.now()

  if (pathname === '/api/updates/latest.json') {
    const found = await manifest(env, origin, now)
    if (!found) return new Response(null, { status: 204 })
    return Response.json(found, { headers: { 'Cache-Control': 'no-store' } })
  }

  const id = Number(pathname.match(/^\/api\/updates\/assets\/(\d+)$/)?.[1])
  const release = await latestRelease(env, now)
  // Only files of the latest release: this route is not a way into the whole repository.
  if (!release?.assets.some((asset) => asset.id === id)) {
    return new Response('Not found', { status: 404 })
  }
  const location = await assetLocation(env, id)
  if (!location) return new Response('Download unavailable, try again', { status: 502 })
  return redirect(location)
}
