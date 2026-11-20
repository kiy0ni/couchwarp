import { useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ALL_BADGES, BADGE_ICONS } from '../components/Badges'
import { Link } from '../components/Link'
import { Page, Section } from '../components/Page'
import { Shell } from '../components/Shell'
import { lang, t } from '../i18n'
import { useAccount } from '../lib/account'
import { askFriend, fullTag } from '../lib/friends'
import { type Badge, fetchProfile, type PublicProfile } from '../lib/profile'
import { navigate } from '../lib/router'

const since = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' })

/** Someone's profile: picture, name, tag, when they arrived, and their badges. */
export function Profile({ userId }: { userId: string }) {
  const { account } = useAccount()
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined)
  const [asked, setAsked] = useState<'idle' | 'sent' | 'refused'>('idle')
  useEffect(() => {
    fetchProfile(userId)
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [userId])

  if (profile === undefined) return <Shell onBack={() => history.back()}>{null}</Shell>
  if (profile === null) {
    return (
      <Shell onBack={() => navigate('/')}>
        <Page title={t.profilePage.missing} width="narrow">
          {null}
        </Page>
      </Shell>
    )
  }
  const self = account?.id === profile.id
  const tag = fullTag(profile.displayName, profile.tag)
  return (
    <Shell onBack={() => history.back()}>
      <div className="page" data-width="narrow">
        <section className="card profile-card" data-color={profile.color ?? undefined}>
          <Avatar
            name={profile.displayName}
            url={profile.avatarUrl}
            color={profile.color}
            size={112}
          />
          <h1 className="page__title">{profile.displayName}</h1>
          {tag && <p className="profile__tag">{tag}</p>}
          <p className="muted">{t.profilePage.since(since.format(profile.memberSince))}</p>
          <div className="actions">
            {self ? (
              <Link to="/parametres/compte" className="button button--secondary">
                {t.profilePage.edit}
              </Link>
            ) : (
              account && (
                <button
                  type="button"
                  className="button"
                  disabled={asked !== 'idle'}
                  onClick={() =>
                    askFriend(profile.id)
                      .then(() => setAsked('sent'))
                      .catch(() => setAsked('refused'))
                  }
                >
                  {asked === 'sent' ? t.friends.added : t.friends.add}
                </button>
              )
            )}
          </div>
          {asked === 'refused' && <p className="field__help">{t.profilePage.addRefused}</p>}
        </section>

        <Section
          title={t.profilePage.badges(profile.badges.length)}
          actions={
            <Link to="/badges" className="link-button">
              {t.profilePage.allBadges}
            </Link>
          }
        >
          <BadgeGrid earned={profile.badges} />
        </Section>
      </div>
    </Shell>
  )
}

/** Every badge, lit when earned, with what earns it. */
export function BadgeGrid({ earned }: { earned: readonly Badge[] | null }) {
  return (
    <ul className="badge-grid">
      {ALL_BADGES.map((badge) => {
        const Glyph = BADGE_ICONS[badge]
        const has = earned?.includes(badge) ?? false
        return (
          <li
            key={badge}
            className="card badge-card"
            data-badge={badge}
            data-earned={earned === null ? undefined : has}
          >
            <span className="badge-card__icon">
              <Glyph
                size={28}
                weight={has || earned === null ? 'duotone' : 'regular'}
                aria-hidden="true"
              />
            </span>
            <span className="badge-card__text">
              <span className="badge-card__name">{t.badges[badge].name}</span>
              <span className="muted">{t.badges[badge].help}</span>
            </span>
            {earned !== null && (
              <span className="badge-card__state">
                {has ? t.profilePage.earned : t.profilePage.locked}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** All the badges, and which ones the signed-in person has. */
export function BadgesPage() {
  const { account } = useAccount()
  return (
    <Shell onBack={() => history.back()}>
      <Page title={t.profilePage.allBadges} lead={t.profilePage.badgesLead} width="narrow">
        <BadgeGrid earned={account ? account.badges : null} />
      </Page>
    </Shell>
  )
}
