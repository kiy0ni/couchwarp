import { t } from '../i18n'

export function Wordmark() {
  return (
    <a className="wordmark" href="/" aria-label={t.wordmark}>
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
