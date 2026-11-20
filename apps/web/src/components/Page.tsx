import type { ReactNode } from 'react'

interface Props {
  title: string
  lead?: ReactNode
  /** Buttons on the right of the title, under it on a phone. */
  actions?: ReactNode
  /** `narrow` for forms and reading, `wide` for grids. */
  width?: 'narrow' | 'wide'
  children: ReactNode
}

/** The title of a page, then its content. */
export function Page({ title, lead, actions, width = 'wide', children }: Props) {
  return (
    <div className="page" data-width={width}>
      <header className="page__head">
        <div className="page__heading">
          <h1 className="page__title">{title}</h1>
          {lead && <p className="page__lead">{lead}</p>}
        </div>
        {actions && <div className="page__actions">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

/** A titled block of a page. */
export function Section({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="section">
      <header className="section__head">
        <h2 className="section__title">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  )
}
