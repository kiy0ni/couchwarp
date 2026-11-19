interface Props<T extends string> {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange(value: T): void
}

/** A choice between a few options as radio buttons, so arrows and screen readers work as usual. */
export function Choice<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <fieldset className="choice">
      <legend className="choice__label">{label}</legend>
      {options.map(([option, text]) => (
        <label key={option} className="choice__option">
          <input
            type="radio"
            name={label}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {text}
        </label>
      ))}
    </fieldset>
  )
}
