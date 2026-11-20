import { t } from '../i18n'
import { Link } from './Link'

export function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label={t.wordmark}>
      <span className="wordmark__lights" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      Couchwarp
    </Link>
  )
}
