import type { ComponentProps, MouseEvent } from 'react'
import { navigate } from '../lib/router'

type Props = Omit<ComponentProps<'a'>, 'href'> & { to: string }

/** A link inside the app: changes page without reloading, opens a new tab as usual. */
export function Link({ to, onClick, ...rest }: Props) {
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={go} {...rest} />
}
