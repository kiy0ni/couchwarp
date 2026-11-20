import { exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetRelease } from '../src/updates'
import { SITE } from './helpers'

const API = 'https://api.github.com/repos/kiy0ni/couchwarp'
const DOWNLOAD = 'https://github.com/kiy0ni/couchwarp/releases/download/v0.2.0'

const RELEASE = {
  tag_name: 'v0.2.0',
  assets: [
    { id: 11, name: 'latest.json' },
    { id: 12, name: 'Couchwarp_aarch64.app.tar.gz' },
    { id: 13, name: 'Couchwarp_0.2.0_x64-setup.exe' },
    { id: 14, name: 'Couchwarp_0.2.0_aarch64.dmg' },
    { id: 15, name: 'Couchwarp_0.2.0_amd64.AppImage' },
    { id: 16, name: 'Couchwarp_0.2.0_amd64.AppImage.sig' },
    { id: 17, name: 'Couchwarp_0.2.0_amd64.deb' },
  ],
}

const MANIFEST = {
  version: '0.2.0',
  notes: 'Faster start',
  pub_date: '2026-11-20T10:00:00Z',
  platforms: {
    'darwin-aarch64': { signature: 'sig-mac', url: `${DOWNLOAD}/Couchwarp_aarch64.app.tar.gz` },
    'windows-x86_64': { signature: 'sig-win', url: `${DOWNLOAD}/Couchwarp_0.2.0_x64-setup.exe` },
    'linux-x86_64': { signature: 'sig-linux', url: `${DOWNLOAD}/Couchwarp_0.2.0_amd64.AppImage` },
  },
}

/** GitHub as the server sees it: the release, then a signed address for each file. */
function github(release: unknown = RELEASE) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === `${API}/releases/latest`) {
      return release ? Response.json(release) : new Response('Not Found', { status: 404 })
    }
    const asset = url.match(/\/releases\/assets\/(\d+)$/)?.[1]
    if (asset) {
      return new Response(null, {
        status: 302,
        headers: { Location: `https://objects.example/${asset}?signed=1` },
      })
    }
    if (url === 'https://objects.example/11?signed=1') return Response.json(MANIFEST)
    return new Response('unexpected', { status: 500 })
  })
}

function get(path: string) {
  return exports.default.fetch(`${SITE}${path}`, { redirect: 'manual' })
}

beforeEach(() => forgetRelease())
afterEach(() => vi.restoreAllMocks())

describe('desktop app updates', () => {
  it('hand out the release manifest with links through this server', async () => {
    github()
    const response = await get('/api/updates/latest.json')
    expect(response.status).toBe(200)
    const manifest = await response.json<typeof MANIFEST>()
    expect(manifest.version).toBe('0.2.0')
    expect(manifest.platforms['darwin-aarch64']).toEqual({
      signature: 'sig-mac',
      url: `${SITE}/api/updates/assets/12`,
    })
    expect(manifest.platforms['windows-x86_64']?.url).toBe(`${SITE}/api/updates/assets/13`)
    expect(manifest.platforms['linux-x86_64']?.url).toBe(`${SITE}/api/updates/assets/15`)
  })

  it('redirect a file of the latest release, and nothing else', async () => {
    github()
    const file = await get('/api/updates/assets/12')
    expect(file.status).toBe(302)
    expect(file.headers.get('Location')).toBe('https://objects.example/12?signed=1')
    expect((await get('/api/updates/assets/99')).status).toBe(404)
  })

  it('answer no content while there is no release, and ask GitHub once', async () => {
    const calls = github(null)
    expect((await get('/api/updates/latest.json')).status).toBe(204)
    expect((await get('/api/updates/latest.json')).status).toBe(204)
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('offer the release installers on the Host page', async () => {
    github()
    const downloads = await (await get('/api/downloads')).json()
    // The AppImage itself, not its signature beside it.
    expect(downloads).toEqual({
      mac: `${SITE}/api/updates/assets/14`,
      windows: `${SITE}/api/updates/assets/13`,
      linux: `${SITE}/api/updates/assets/15`,
      linuxDeb: `${SITE}/api/updates/assets/17`,
    })
  })
})
