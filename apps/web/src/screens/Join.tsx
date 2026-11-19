import { type FormEvent, useEffect, useState } from 'react'
import { Wordmark } from '../components/Wordmark'
import { t } from '../i18n'
import { useGamepadNavigation } from '../lib/gamepad-nav'
import { isRoomOpen } from '../lib/session'
import { useGamepads } from '../lib/use-gamepads'

const NAME_KEY = 'couchwarp.name'
const MAX_NAME_LENGTH = 24

/** The stream the host sends, at the size and rate it usually runs. */
const STREAM_FORMAT: VideoConfiguration = {
  contentType: 'video/H264; profile-level-id=42e01f; packetization-mode=1',
  width: 1920,
  height: 1080,
  bitrate: 12_000_000,
  framerate: 60,
}

type VideoSupport = 'checking' | 'hardware' | 'software'

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    // Storage is blocked in some private modes; the field just starts empty.
    return ''
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Same as above: remembering the name is a convenience, not a requirement.
  }
}

function useVideoSupport(): VideoSupport {
  const [support, setSupport] = useState<VideoSupport>('checking')
  useEffect(() => {
    navigator.mediaCapabilities
      .decodingInfo({ type: 'webrtc', video: STREAM_FORMAT })
      .then((info) => setSupport(info.powerEfficient ? 'hardware' : 'software'))
      .catch(() => setSupport('software'))
  }, [])
  return support
}

interface Props {
  code: string
  onPlay(name: string): void
  onBack(): void
  /** The room closed or never existed: a shared link can be old. */
  onClosed(): void
}

export function Join({ code, onPlay, onBack, onClosed }: Props) {
  const [name, setName] = useState(savedName)
  useEffect(() => {
    let current = true
    isRoomOpen(code)
      .then((open) => {
        if (current && !open) onClosed()
      })
      // Not fatal: if the room is really gone, joining reports it.
      .catch((error) => console.error('Room check failed', error))
    return () => {
      current = false
    }
  }, [code, onClosed])
  const gamepads = useGamepads()
  const video = useVideoSupport()
  const webrtc = typeof RTCPeerConnection === 'function'
  const trimmed = name.trim()
  useGamepadNavigation(true, onBack)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || !webrtc) return
    saveName(trimmed)
    onPlay(trimmed)
  }

  return (
    <main className="screen">
      <header className="topbar">
        <Wordmark />
        <button type="button" className="link-button" onClick={onBack}>
          {t.join.back}
        </button>
      </header>
      <form className="panel" onSubmit={submit}>
        <h1 className="title">{t.join.title(code)}</h1>
        <div className="field">
          <label className="field__label" htmlFor="guest-name">
            {t.join.nameLabel}
          </label>
          <input
            id="guest-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            name="nickname"
            autoComplete="nickname"
            maxLength={MAX_NAME_LENGTH}
            required
            aria-describedby="guest-name-help"
          />
          <p id="guest-name-help" className="field__help">
            {t.join.nameHelp}
          </p>
        </div>

        <section className="checks" aria-labelledby="device-title">
          <h2 id="device-title" className="checks__title">
            {t.join.deviceTitle}
          </h2>
          <ul className="checks__list">
            <li data-state={webrtc ? 'ok' : 'blocking'}>
              {webrtc ? t.join.browserOk : t.join.browserMissing}
            </li>
            <li data-state={video === 'software' ? 'warning' : 'ok'}>
              {video === 'checking'
                ? t.join.videoChecking
                : video === 'hardware'
                  ? t.join.videoHardware
                  : t.join.videoSoftware}
            </li>
            {gamepads.length === 0 ? (
              <li data-state="info">{t.join.noPad}</li>
            ) : (
              gamepads.map((gamepad, i) => (
                <li key={gamepad.index} data-state="ok">
                  {t.join.pad(i + 1, gamepad.id.replace(/\s*\(.*\)\s*$/, ''))}
                </li>
              ))
            )}
          </ul>
        </section>

        <button type="submit" className="button" disabled={!trimmed || !webrtc}>
          {t.join.play}
        </button>
      </form>
    </main>
  )
}
