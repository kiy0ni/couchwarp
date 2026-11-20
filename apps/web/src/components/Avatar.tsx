import type { ProfileColor } from '../lib/profile'

/**
 * A round avatar, or the name's first letter when there is no picture. `color`, the one
 * the person chose, rings it like a player light.
 */
export function Avatar({
  name,
  url,
  color = null,
  size = 32,
}: {
  name: string
  url: string | null
  color?: ProfileColor | null | undefined
  size?: number
}) {
  const style = { width: size, height: size, fontSize: size * 0.42 }
  return url ? (
    <img
      className="avatar"
      data-color={color ?? undefined}
      src={url}
      alt=""
      width={size}
      height={size}
      style={style}
    />
  ) : (
    <span className="avatar" data-color={color ?? undefined} style={style} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
