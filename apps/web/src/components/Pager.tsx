import { t } from '../i18n'

/** Previous and next under a list split into pages. Nothing shows for a single page. */
export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number
  pages: number
  onPage(page: number): void
}) {
  if (pages <= 1) return null
  return (
    <nav className="pager" aria-label={t.common.pages}>
      <button
        type="button"
        className="button button--secondary button--small"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        {t.common.previous}
      </button>
      <span className="pager__where num" aria-live="polite">
        {t.common.pageOf(page + 1, pages)}
      </span>
      <button
        type="button"
        className="button button--secondary button--small"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        {t.common.next}
      </button>
    </nav>
  )
}
