import { useEffect, useState } from 'react'

/** What this Couchwarp server offers. Mirrors `/api/config`. */
export interface ServerConfig {
  publicRooms: boolean
  relay: boolean
}

let cached: Promise<ServerConfig> | null = null

/** Asked once per page load; until then, null. */
export function useServerConfig(): ServerConfig | null {
  const [config, setConfig] = useState<ServerConfig | null>(null)
  useEffect(() => {
    cached ??= fetch('/api/config')
      .then((response) => response.json() as Promise<ServerConfig>)
      .catch(() => ({ publicRooms: false, relay: false }))
    cached.then(setConfig)
  }, [])
  return config
}
