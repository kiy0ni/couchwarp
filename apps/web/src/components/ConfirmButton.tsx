import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'

interface Props {
  className: string
  /** Asked next to the button on the first press. */
  question: string
  confirmLabel: string
  onConfirm(): void
  children: ReactNode
}

/**
 * A button for something that cannot be undone. The first press asks on the spot; the
 * browser's own `confirm()` box never shows in the desktop app's window.
 */
export function ConfirmButton({ className, question, confirmLabel, onConfirm, children }: Props) {
  const [asking, setAsking] = useState(false)
  const confirm = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (asking) confirm.current?.focus()
  }, [asking])

  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {children}
      </button>
    )
  }
  return (
    <span className="confirm">
      <span className="confirm__question" role="status">
        {question}
      </span>
      <button
        ref={confirm}
        type="button"
        className={className}
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="link-button" onClick={() => setAsking(false)}>
        {t.common.cancel}
      </button>
    </span>
  )
}
