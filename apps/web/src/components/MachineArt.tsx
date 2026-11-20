/**
 * A screen with the four player lights on it: the picture of a computer that hosts. The
 * lights glow in their colours when a game is running, and rest when it is not.
 */
export function MachineArt({ live = false }: { live?: boolean }) {
  return (
    <svg
      className="machine-art"
      data-live={live || undefined}
      viewBox="0 0 160 112"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="machine-art__case" x="14" y="6" width="132" height="82" rx="12" />
      <rect className="machine-art__glass" x="24" y="16" width="112" height="62" rx="6" />
      <circle className="machine-art__light" cx="59" cy="47" r="6" />
      <circle className="machine-art__light" cx="73" cy="47" r="6" />
      <circle className="machine-art__light" cx="87" cy="47" r="6" />
      <circle className="machine-art__light" cx="101" cy="47" r="6" />
      <path className="machine-art__stand" d="M68 88h24l6 16H62z" />
      <rect className="machine-art__case" x="50" y="102" width="60" height="6" rx="3" />
    </svg>
  )
}
