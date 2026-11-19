import { useEffect, useRef, useState } from 'react'
import { PlayerBadge } from '../components/PlayerBadge'
import { t } from '../i18n'
import type { EndReason } from '../lib/session'
import { useInputForwarding } from '../lib/use-input'
import { type Measures, useStream } from '../lib/use-stream'

const CHROME_IDLE_MS = 3000

type KeyboardLockNavigator = Navigator & { keyboard?: { lock(): Promise<void> } }

async function enterFullscreen(element: HTMLElement): Promise<void> {
  if (!element.requestFullscreen) return
  await element.requestFullscreen({ navigationUI: 'hide' })
  // Chromium only: Escape and system shortcuts reach the game instead of the browser.
  await (navigator as KeyboardLockNavigator).keyboard?.lock()
}

/** Shows the top bar while the pointer moves, hides it after a few idle seconds. */
function useIdleChrome(): [visible: boolean, wake: () => void] {
  const [visible, setVisible] = useState(true)
  const timer = useRef(0)
  const wake = () => {
    setVisible(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setVisible(false), CHROME_IDLE_MS)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [visible, wake]
}

function ms(value: number | null): string {
  return value === null ? '…' : `${Math.round(value)} ms`
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
  const stream = useStream(code, name, video, onEnd)
  useInputForwarding(stream.session, surface, stream.forgetPad)
  const [chromeVisible, wakeChrome] = useIdleChrome()
  const showChrome = chromeVisible || !stream.hasPicture || stream.paused
  const players = [...stream.slots.values()].sort((a, b) => a - b)

  return (
    <main
      ref={surface}
      className="play"
      tabIndex={-1}
      aria-label={t.join.title(code)}
      data-idle={showChrome ? undefined : true}
      onPointerMove={wakeChrome}
      onPointerDown={wakeChrome}
    >
      <video
        ref={video}
        className="play__video"
        muted
        playsInline
        autoPlay
        disablePictureInPicture
      />

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

      <div className="play__bar">
        <ul className="play__players">
          {players.map((slot) => (
            <li key={slot}>
              <PlayerBadge slot={slot} />
            </li>
          ))}
        </ul>
        <p className="play__latency">
          <span className="play__latency-label">{t.play.latency}</span>
          <span className="num">{ms(stream.measures.median)}</span>
        </p>
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => menu.current?.showModal()}
        >
          {t.play.menu}
        </button>
      </div>

      <dialog ref={menu} className="menu" onClose={() => surface.current?.focus()}>
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
          <button type="button" className="link-button" onClick={() => menu.current?.close()}>
            {t.play.closeMenu}
          </button>
        </div>
      </dialog>
    </main>
  )
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
