import { type ChatMessage, MAX_CHAT_LENGTH } from '@couchwarp/protocol'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'

interface Props {
  messages: readonly ChatMessage[]
  hostName: string
  onSend(text: string): void
  /** Where the field takes focus when the panel opens. */
  autoFocus?: boolean
}

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** The room chat: the latest messages at the bottom, the field under them. */
export function ChatPanel({ messages, hostName, onSend, autoFocus = false }: Props) {
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLOListElement>(null)

  // Follow new messages, as chats do.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message arrives
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  return (
    <div className="chat">
      {messages.length === 0 ? (
        <p className="chat__empty">{t.room.chatEmpty}</p>
      ) : (
        <ol ref={list} className="chat__list" aria-live="polite">
          {messages.map((message) => (
            <li key={`${message.at}-${message.from}`} className="chat__message">
              <span className="chat__meta">
                <span className="chat__name">
                  {message.from === null ? t.room.chatHost(hostName) : message.name}
                </span>
                <time className="chat__time" dateTime={new Date(message.at).toISOString()}>
                  {time.format(message.at)}
                </time>
              </span>
              <span className="chat__text">{message.text}</span>
            </li>
          ))}
        </ol>
      )}
      <form className="chat__form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="chat-draft">
          {t.room.chatLabel}
        </label>
        <input
          id="chat-draft"
          className="input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the panel opens to write a message
          autoFocus={autoFocus}
        />
        <button type="submit" className="button button--small" disabled={!draft.trim()}>
          {t.room.chatSend}
        </button>
      </form>
    </div>
  )
}
