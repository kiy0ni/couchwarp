import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { desktop, system } from '../lib/desktop'

/**
 * Windows only: guests cannot reach this computer until its firewall lets Couchwarp in.
 * Nothing shows once it does.
 */
export function FirewallNotice() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [refused, setRefused] = useState(false)
  useEffect(() => {
    if (system !== 'windows') return
    desktop.firewallAllowed().then(setAllowed).catch(console.error)
  }, [])
  if (allowed !== false) return null
  return (
    <div className="notice" data-tone="warning" role="status">
      <p>
        <span className="notice__title">{t.firewall.title}</span>
        {refused ? t.firewall.refused : t.firewall.lead}
      </p>
      <button
        type="button"
        className="button button--small"
        onClick={() =>
          desktop
            .allowFirewall()
            .then(setAllowed)
            .catch(() => setRefused(true))
        }
      >
        {t.firewall.allow}
      </button>
    </div>
  )
}

/** Asked as the game starts, so a first host never has to find the setting. */
export async function letGuestsThrough(): Promise<void> {
  if (system !== 'windows') return
  if (await desktop.firewallAllowed().catch(() => true)) return
  // Declined: the game still starts, and the notice stays on the page.
  await desktop.allowFirewall().catch(console.error)
}
