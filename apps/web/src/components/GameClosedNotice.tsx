import { useState } from 'react'
import { t } from '../i18n'
import { desktop } from '../lib/desktop'

/**
 * The game closed while hosting: the room waits, and one press starts the game again when
 * the app knows its program. Sharing picks up the new window on its own either way.
 */
export function GameClosedNotice({ canRelaunch }: { canRelaunch: boolean }) {
  const [step, setStep] = useState<'idle' | 'starting' | 'failed'>('idle')
  async function relaunch() {
    setStep('starting')
    try {
      await desktop.relaunchGame()
      setStep('idle')
    } catch (error) {
      console.error(error)
      setStep('failed')
    }
  }
  return (
    <div className="notice" data-tone="warning" role="status">
      <p>{step === 'failed' ? t.host.relaunchFailed : t.host.gameClosed}</p>
      {canRelaunch && (
        <button
          type="button"
          className="button button--small"
          disabled={step === 'starting'}
          onClick={relaunch}
        >
          {step === 'starting' ? t.host.relaunching : t.host.relaunch}
        </button>
      )}
    </div>
  )
}
