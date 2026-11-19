import type { MouseEventHandler } from 'react'
import { t } from '../i18n'

export function Wordmark({ onClick }: { onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <a className="wordmark" href="/" aria-label={t.wordmark} onClick={onClick}>
      <span className="wordmark__lights" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      Couchwarp
    </a>
  )
}
