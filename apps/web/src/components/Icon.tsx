/** Line icons for the navigation, drawn on a 24 px grid with the text colour. */

const PATHS = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V20h-5v-5.5H9V20H4z" />
    </>
  ),
  rooms: (
    <>
      <rect x="3.5" y="4.5" width="7.5" height="6.5" rx="1.5" />
      <rect x="13" y="4.5" width="7.5" height="6.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="6.5" rx="1.5" />
      <rect x="13" y="13" width="7.5" height="6.5" rx="1.5" />
    </>
  ),
  host: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16v4" />
      <path d="m10.5 8 4 2-4 2z" />
    </>
  ),
  friends: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20c.7-3.6 3.3-5.5 6.5-5.5s5.8 1.9 6.5 5.5" />
      <path d="M16 5.2a3.3 3.3 0 0 1 0 6.6M18 14.8c1.8.6 3 2.4 3.5 5.2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6.2v5.6c0 4.2 3 7.6 7 8.7 4-1.1 7-4.5 7-8.7V6.2z" />
    </>
  ),
  pad: (
    <>
      <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 3.6l.9 4.6a2.7 2.7 0 0 1-4.6 2.4L15 15.5H9l-2.2 2.1a2.7 2.7 0 0 1-4.6-2.4l.9-4.6A4.5 4.5 0 0 1 7.5 7z" />
      <path d="M8 10v3M6.5 11.5h3" />
      <circle cx="16" cy="11.5" r=".6" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9" />
    </>
  ),
  app: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M3.5 8.5h17" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20.5c.9-4 4-6.3 7.5-6.3s6.6 2.3 7.5 6.3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
    </>
  ),
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
