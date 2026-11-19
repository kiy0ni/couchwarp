/** A round avatar, or the name's first letter when there is no picture. */
export function Avatar({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <img className="avatar" src={url} alt="" width={32} height={32} />
  ) : (
    <span className="avatar" aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
