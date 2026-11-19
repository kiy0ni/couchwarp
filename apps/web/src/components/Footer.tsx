import type { MouseEvent } from 'react'
import { t } from '../i18n'
import { navigate } from '../lib/router'

function go(path: string) {
  return (event: MouseEvent) => {
    event.preventDefault()
    navigate(path)
  }
}

/** The legal links, at the bottom of the pages that are not a game. */
export function Footer() {
  return (
    <footer className="footer">
      <a className="link-button" href="/conditions" onClick={go('/conditions')}>
        {t.footer.terms}
      </a>
      <a className="link-button" href="/confidentialite" onClick={go('/confidentialite')}>
        {t.footer.privacy}
      </a>
    </footer>
  )
}
