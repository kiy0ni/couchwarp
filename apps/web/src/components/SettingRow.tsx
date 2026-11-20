import type { ReactNode } from 'react'

/** One setting: what it does on the left, its control on the right (under it on a phone). */
export function SettingRow({
  id,
  title,
  help,
  children,
}: {
  /** The control's id, so the title labels it. */
  id: string
  title: string
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="setting">
      <div className="setting__text">
        <label className="setting__title" htmlFor={id}>
          {title}
        </label>
        {help && <p className="setting__help">{help}</p>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  )
}

/** An on/off switch: a checkbox drawn as a switch, so it behaves as one everywhere. */
export function Switch({
  id,
  checked,
  onChange,
}: {
  id: string
  checked: boolean
  onChange(checked: boolean): void
}) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="switch"
      checked={checked}
      aria-checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

/** A small set of choices as a native select. */
export function Select<T extends string | number>({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange(value: T): void
}) {
  return (
    <select
      id={id}
      className="input"
      value={String(value)}
      onChange={(event) => {
        const found = options.find(([option]) => String(option) === event.target.value)
        if (found) onChange(found[0])
      }}
    >
      {options.map(([option, label]) => (
        <option key={String(option)} value={String(option)}>
          {label}
        </option>
      ))}
    </select>
  )
}
