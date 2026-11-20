import type { ChatMessage, PadType } from '@couchwarp/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatPanel } from '../components/ChatPanel'
import { Choice } from '../components/Choice'
import { GameBubble } from '../components/GameBubble'
import { KeyboardHelp } from '../components/KeyboardHelp'
import { MemberList } from '../components/MemberList'
import { PlayerBadge } from '../components/PlayerBadge'
import { ReportDialog, type ReportTarget } from '../components/ReportDialog'
import { TouchPad } from '../components/TouchPad'
import { t } from '../i18n'
import { placeMenu } from '../lib/bubble-menu'
import { isDesktop } from '../lib/desktop'
import { latencyQuality } from '../lib/latency'
import { startNativeMotion, startPhoneMotion, stopPhoneMotion } from '../lib/motion'
import type { PadState } from '../lib/pad-state'
import { preferences, usePreferences } from '../lib/preferences'
import type { EndReason } from '../lib/session'
import { useGamepads } from '../lib/use-gamepads'
import {
  type KeyboardMode,
  releasePointer,
  type Shortcut,
  useInputForwarding,
} from '../lib/use-input'
import { countdown, useNow } from '../lib/use-now'
import { type Measures, useStream } from '../lib/use-stream'

/** How long a chat message stays over the game while the chat is closed. */
const TOAST_MS = 5000

type KeyboardLockNavigator = Navigator & { keyboard?: { lock(): Promise<void> } }

async function enterFullscreen(element: HTMLElement): Promise<void> {
  if (!element.requestFullscreen) return
  await element.requestFullscreen({ navigationUI: 'hide' })
  // Chromium only: Escape and system shortcuts reach the game instead of the browser.
  await (navigator as KeyboardLockNavigator).keyboard?.lock()
}

function ms(value: number | null): string {
  return value === null ? '…' : `${Math.round(value)} ms`
}

/**
 * Messages read and the latest one to show over the game: unread ones count up while
 * the chat is closed, and each new message from someone else shows for a few seconds.
 */
function useChatNotices(messages: readonly ChatMessage[], open: boolean, selfId: number | null) {
  const [seen, setSeen] = useState(0)
  const [toast, setToast] = useState<ChatMessage | null>(null)
  if (open && seen !== messages.length) setSeen(messages.length)
  const latest = messages.at(-1)
  const quiet = useRef(true)
  quiet.current = open || latest?.from === selfId

  // Runs once per new message, so closing the chat never brings an old one back.
  useEffect(() => {
    if (!latest || quiet.current) return
    setToast(latest)
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [latest])

  return { unread: open ? 0 : messages.length - seen, toast: open ? null : toast }
}

interface Props {
  code: string
  name: string
  onEnd(reason: EndReason): void
  onLeave(): void
}

export function Play({ code, name, onEnd, onLeave }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const surface = useRef<HTMLElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const chatDialog = useRef<HTMLDialogElement>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [reporting, setReporting] = useState<ReportTarget | null>(null)
  const stream = useStream(code, name, video, onEnd)
  const { room, me, session } = stream
  const gamepads = useGamepads()
  const [touchScreen] = useState(() => matchMedia('(pointer: coarse)').matches)
  const prefs = usePreferences()
  const [keyboardChoice, setKeyboardChoice] = useState<'keys' | 'pad' | null>(null)
  const [touchWanted, setTouchWanted] = useState(() => preferences().touchPad)
  const touch = useRef<PadState | null>(null)

  // Until the room state arrives, the guest is taken as a player: the host checks anyway.
  const playing = me === null || me.role !== 'spectator'
  const keyboardAllowed = me?.keyboard ?? false
  const padsAllowed = playing && (me?.pads ?? true)
  // A controller, real or played from the keyboard, only helps when it reaches the game.
  const padsPlay = padsAllowed && stream.virtualPads === true
  const preferred = keyboardChoice ?? (padsPlay ? prefs.keyboardMode : 'keys')
  const keyboardMode: KeyboardMode = !playing
    ? 'off'
    : keyboardAllowed
      ? padsPlay
        ? preferred
        : 'keys'
      : padsPlay
        ? 'pad'
        : 'off'
  const showTouch = padsPlay && touchScreen && gamepads.length === 0 && touchWanted
  if (!showTouch) touch.current = null

  const mouseAllowed = playing && (me?.mouse ?? false)
  const [pointerLocked, setPointerLocked] = useState(false)
  /** From the bubble, the menu unfolds next to it; from a shortcut, it opens centred. */
  const openMenu = useCallback((bubble?: DOMRect) => {
    const dialog = menu.current
    if (!dialog) return
    releasePointer()
    delete dialog.dataset.direction
    dialog.showModal()
    if (!bubble) return
    const screen = { width: window.innerWidth, height: window.innerHeight }
    const place = placeMenu(bubble, screen, dialog.offsetWidth)
    dialog.style.setProperty('--menu-left', `${place.left}px`)
    dialog.style.setProperty('--menu-offset', `${place.offset}px`)
    dialog.style.setProperty('--menu-room', `${place.maxHeight}px`)
    dialog.dataset.direction = place.direction
  }, [])
  const openChat = useCallback(() => {
    releasePointer()
    chatDialog.current?.showModal()
    setChatOpen(true)
  }, [])
  const onShortcut = useCallback(
    (shortcut: Shortcut) => {
      if (shortcut === 'menu') openMenu()
      else if (shortcut === 'chat') openChat()
      else if (surface.current) {
        enterFullscreen(surface.current).catch((error) => console.warn(error))
      }
    },
    [openMenu, openChat],
  )
  useInputForwarding(playing ? session : null, surface, {
    keyboardMode,
    pads: padsAllowed,
    touch,
    mouse: mouseAllowed,
    onPadRemoved: stream.forgetPad,
    onPointerLock: setPointerLocked,
    onShortcut,
  })
  const notices = useChatNotices(stream.chat, chatOpen, me?.id ?? null)
  // In the app, controllers' gyroscopes are read by the app itself.
  useEffect(() => {
    if (isDesktop) startNativeMotion().catch(console.error)
  }, [])
  // The phone's gyroscope, while its touch controller plays.
  useEffect(() => {
    if (!showTouch || !prefs.phoneMotion) return
    startPhoneMotion().catch(console.error)
    return stopPhoneMotion
  }, [showTouch, prefs.phoneMotion])
  // The controller type picked in the settings, sent once the room knows this guest.
  const myId = me?.id
  const myPadType = me?.padType
  const padTypeSentFor = useRef<number | null>(null)
  useEffect(() => {
    if (myId === undefined || !stream.virtualPads || padTypeSentFor.current === myId) return
    padTypeSentFor.current = myId
    const wanted = preferences().padType
    if (myPadType !== wanted) {
      session?.sendRoom({ type: 'set-pad-type', guestId: myId, padType: wanted })
    }
  }, [myId, myPadType, stream.virtualPads, session])
  const turnEndsAt = room?.turnEndsAt ?? null
  const now = useNow(turnEndsAt !== null)
  const players = [...stream.slots.values()].sort((a, b) => a - b)
  const placeInLine = me ? (room?.queue.indexOf(me.id) ?? -1) + 1 : 0
  const median = stream.measures.median
  const slow = median !== null && latencyQuality(median) === 'poor'

  return (
    <main ref={surface} className="play" tabIndex={-1} aria-label={t.join.title(code)}>
      {/* biome-ignore lint/a11y/useMediaCaption: a live game stream has no caption source */}
      <video ref={video} className="play__video" playsInline autoPlay disablePictureInPicture />

      {!stream.hasPicture && (
        <p className="play__notice" role="status">
          {t.play.waiting}
        </p>
      )}
      {stream.paused && (
        <p className="play__notice play__notice--paused" role="status">
          {t.play.paused}
        </p>
      )}

      {!playing && (
        <div className="play__notice play__notice--watching" role="status">
          <p>{placeInLine > 0 ? t.room.inLine(placeInLine) : t.room.watching}</p>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => session?.sendRoom({ type: 'raise-hand', raised: placeInLine === 0 })}
          >
            {placeInLine > 0 ? t.room.lowerHand : t.room.raiseHand}
          </button>
        </div>
      )}
      {mouseAllowed && stream.hasPicture && !touchScreen && (
        <p className="play__hint" data-fading={pointerLocked || undefined}>
          {pointerLocked ? t.room.mouseLockedHint : t.room.mouseHint}
        </p>
      )}
      {prefs.connectionWarnings && slow && stream.hasPicture && (
        <p className="play__notice play__notice--warning" role="status">
          {t.play.slowConnection}
        </p>
      )}
      {stream.soundBlocked && (
        <button type="button" className="button play__sound" onClick={stream.enableSound}>
          {t.play.enableSound}
        </button>
      )}
      {prefs.chatOverGame && notices.toast && (
        <p className="play__toast" role="status">
          <span className="chat__name">{notices.toast.name}</span> {notices.toast.text}
        </p>
      )}

      {showTouch && <TouchPad state={touch} />}

      <GameBubble
        unread={notices.unread}
        attention={!stream.hasPicture || stream.paused || !playing}
        onOpen={openMenu}
        onMoved={() => surface.current?.focus()}
      >
        {players.length > 0 && (
          <span className="bubble__players">
            {players.map((slot) => (
              <PlayerBadge key={slot} slot={slot} />
            ))}
          </span>
        )}
        {turnEndsAt !== null && (
          <span className="bubble__item">
            <span className="visually-hidden">{t.room.turnLeft}</span>
            <span className="num">{countdown(turnEndsAt - now)}</span>
          </span>
        )}
        {prefs.latencyOnBubble && (
          <span
            className="bubble__item play__latency"
            data-quality={median === null ? undefined : latencyQuality(median)}
          >
            <span className="num">{ms(median)}</span>
            {median !== null && (
              <span className="visually-hidden">
                {t.play.latency} {qualityLabel(latencyQuality(median))}
              </span>
            )}
          </span>
        )}
      </GameBubble>

      <ReportDialog target={reporting} onClose={() => setReporting(null)} />

      <dialog
        ref={chatDialog}
        className="menu menu--chat"
        aria-label={t.room.chatTitle}
        onClose={() => {
          setChatOpen(false)
          surface.current?.focus()
        }}
      >
        <div className="menu__head">
          <h2 className="menu__title">{t.room.chatTitle}</h2>
          <button type="button" className="link-button" onClick={() => chatDialog.current?.close()}>
            {t.room.chatClose}
          </button>
        </div>
        {chatOpen && (
          <ChatPanel
            messages={stream.chat}
            hostName={room?.hostName ?? ''}
            onSend={(text) => session?.sendRoom({ type: 'chat', text })}
            autoFocus
          />
        )}
      </dialog>

      <dialog ref={menu} className="menu" onClose={() => surface.current?.focus()}>
        <div className="menu__head">
          <h2 className="menu__title">{t.play.menu}</h2>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => {
              menu.current?.close()
              openChat()
            }}
          >
            {t.room.chatOpen(notices.unread)}
          </button>
        </div>
        <h2 className="menu__title">{t.play.controlsTitle}</h2>
        {stream.virtualPads === false && <p className="menu__note">{t.play.padsUnavailable}</p>}
        {playing && !padsAllowed && <p className="menu__note">{t.room.padsOff}</p>}
        {playing && !keyboardAllowed && (
          <p className="menu__note">{padsPlay ? t.room.keyboardNotAllowed : t.room.keyboardOff}</p>
        )}
        {padsPlay && (
          <div className="menu__settings">
            {keyboardAllowed && (
              <Choice<'keys' | 'pad'>
                label={t.play.keyboardLabel}
                value={preferred}
                options={[
                  ['pad', t.play.keyboardAsPad],
                  ['keys', t.play.keyboardAsKeys],
                ]}
                onChange={setKeyboardChoice}
              />
            )}
            {me && (
              <Choice<PadType>
                label={t.room.padTypeLabel}
                value={me.padType}
                options={[
                  ['xbox360', t.room.padXbox],
                  ['dualshock4', t.room.padPlayStation],
                ]}
                onChange={(padType) =>
                  session?.sendRoom({ type: 'set-pad-type', guestId: me.id, padType })
                }
              />
            )}
            {touchScreen && (
              <Choice<'show' | 'hide'>
                label={t.play.touchLabel}
                value={touchWanted ? 'show' : 'hide'}
                options={[
                  ['show', t.play.touchShow],
                  ['hide', t.play.touchHide],
                ]}
                onChange={(value) => setTouchWanted(value === 'show')}
              />
            )}
          </div>
        )}
        {keyboardMode === 'pad' && <KeyboardHelp />}

        {room && (
          <>
            <h2 className="menu__title">{t.room.membersTitle}</h2>
            <MemberList
              room={room}
              viewer={me?.role === 'moderator' ? 'moderator' : 'guest'}
              selfId={me?.id ?? null}
              onCommand={(command) => session?.sendRoom(command)}
              onReport={(member) => setReporting({ code, guestId: member.id, name: member.name })}
            />
          </>
        )}

        <h2 className="menu__title">{t.play.measuresTitle}</h2>
        <MeasuresList measures={stream.measures} />
        <div className="menu__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              menu.current?.close()
              if (surface.current) {
                enterFullscreen(surface.current).catch((error) => console.warn(error))
              }
            }}
          >
            {t.play.fullscreen}
          </button>
          <button type="button" className="button button--secondary" onClick={onLeave}>
            {t.play.leave}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => setReporting({ code, guestId: null, name: '' })}
          >
            {t.report.openRoom}
          </button>
          <button type="button" className="link-button" onClick={() => menu.current?.close()}>
            {t.play.closeMenu}
          </button>
        </div>
      </dialog>
    </main>
  )
}

function qualityLabel(quality: ReturnType<typeof latencyQuality>): string {
  return {
    good: t.room.latencyGood,
    fair: t.room.latencyFair,
    poor: t.room.latencyPoor,
  }[quality]
}

function MeasuresList({ measures }: { measures: Measures }) {
  return (
    <>
      <dl className="measures">
        <dt>{t.play.measuresMedian}</dt>
        <dd className="num">{ms(measures.median)}</dd>
        <dt>{t.play.measuresP95}</dt>
        <dd className="num">{ms(measures.p95)}</dd>
        <dt>{t.play.measuresRoundTrip}</dt>
        <dd className="num">{ms(measures.roundTrip)}</dd>
        <dt>{t.play.measuresFps}</dt>
        <dd className="num">{measures.fps}</dd>
        <dt>{t.play.measuresSize}</dt>
        <dd className="num">
          {measures.width}&nbsp;×&nbsp;{measures.height}
        </dd>
      </dl>
      {!measures.captureTimeKnown && <p className="menu__note">{t.play.measuresUnknown}</p>}
    </>
  )
}
