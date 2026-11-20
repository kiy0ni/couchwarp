import { type FormEvent, useEffect, useState } from 'react'
import { GameCover } from '../components/GameCover'
import { Page } from '../components/Page'
import { PlayerBadge } from '../components/PlayerBadge'
import { Shell } from '../components/Shell'
import { t } from '../i18n'
import { useAccount } from '../lib/account'
import { padName } from '../lib/gamepads'
import { preferences } from '../lib/preferences'
import { lookUpRoom, type RoomPreview } from '../lib/session'
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
  const { account } = useAccount()
  const [name, setName] = useState(savedName)
  // A signed-in player starts with their account name, unless they typed another one before.
  useEffect(() => {
    if (account && !savedName()) setName(account.displayName)
  }, [account])
  const [room, setRoom] = useState<RoomPreview | null>(null)
  useEffect(() => {
    let current = true
    lookUpRoom(code)
      .then((found) => {
        if (!current) return
        if (found) setRoom(found)
        else onClosed()
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

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || !webrtc) return
    saveName(trimmed)
    // The press on Play is the gesture browsers ask for before going full screen.
    if (preferences().fullscreenOnStart) {
      document.documentElement.requestFullscreen?.().catch(() => undefined)
    }
    onPlay(trimmed)
  }

  return (
    <Shell onBack={onBack}>
      <Page
        title={room?.title || t.join.title(code)}
        lead={room ? t.join.lead(room.hostName, room.game) : t.join.checking}
        actions={
          <button type="button" className="button button--secondary" onClick={onBack}>
            {t.join.back}
          </button>
        }
      >
        <div className="columns">
          <form className="card card--feature stack" onSubmit={submit}>
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
            {room && (
              <p className="field__help">
                {room.players < room.maxPlayers
                  ? t.join.seatFree(room.maxPlayers - room.players)
                  : t.join.full}
              </p>
            )}
            <button type="submit" className="button button--large" disabled={!trimmed || !webrtc}>
              {t.join.play}
            </button>
          </form>

          <div className="stack stack--loose">
            {room && <GameCover sources={[room.header, room.cover]} className="join__cover" />}
            {room && (
              <dl className="stats stats--three">
                <div className="stats__item">
                  <dt>{t.join.players}</dt>
                  <dd className="num">
                    {room.players}/{room.maxPlayers}
                  </dd>
                </div>
                <div className="stats__item">
                  <dt>{t.join.spectators}</dt>
                  <dd className="num">{room.spectators}</dd>
                </div>
                <div className="stats__item">
                  <dt>{t.join.code}</dt>
                  <dd className="code">{code}</dd>
                </div>
              </dl>
            )}
            <section className="card checks" aria-labelledby="device-title">
              <h2 id="device-title" className="card__title">
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
                      <span className="checks__pad">
                        <PlayerBadge slot={i + 1} />
                        {padName(gamepad)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </div>
        </div>
      </Page>
    </Shell>
  )
}
