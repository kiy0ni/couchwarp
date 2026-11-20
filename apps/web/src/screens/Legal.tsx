import { Shell } from '../components/Shell'
import { lang } from '../i18n'
import { navigate } from '../lib/router'

/**
 * The terms and the privacy notice. Durations here must match what the code does:
 * `services/edge/src/cleanup.ts` and the session lifetimes in `auth/sessions.ts`.
 */

/** Set at build time, in `apps/web/.env`: who runs this Couchwarp, and how to reach them. */
const PUBLISHER = import.meta.env.VITE_PUBLISHER as string | undefined
const CONTACT = import.meta.env.VITE_CONTACT_EMAIL as string | undefined

type Block = string | readonly string[]
interface Section {
  title: string
  blocks: readonly Block[]
}
interface Page {
  title: string
  updated: string
  sections: readonly Section[]
}

const contactFr = CONTACT ? `Contact : ${CONTACT}.` : null
const contactEn = CONTACT ? `Contact: ${CONTACT}.` : null

const TERMS: Record<'fr' | 'en', Page> = {
  fr: {
    title: 'Conditions d’utilisation',
    updated: 'Mise à jour le 19 novembre 2026',
    sections: [
      {
        title: 'Le service',
        blocks: [
          'Couchwarp permet à une personne, l’hôte, de partager la fenêtre d’un jeu lancé sur son ordinateur, et à des invités d’y jouer depuis un navigateur. Le service est gratuit et fourni tel quel, sans garantie de disponibilité.',
          PUBLISHER ? `Couchwarp est édité par ${PUBLISHER}.` : '',
        ],
      },
      {
        title: 'Âge',
        blocks: ['Il faut avoir 13 ans ou plus pour créer un compte.'],
      },
      {
        title: 'Ce que l’hôte s’engage à faire',
        blocks: [
          [
            'Ne partager que la fenêtre d’un jeu, jamais son bureau, ses fichiers ou des informations personnelles.',
            'Posséder légalement le jeu partagé et respecter sa licence.',
            'Garder le contrôle de sa partie : expulser ou bannir quiconque enfreint ces règles.',
          ],
        ],
      },
      {
        title: 'Ce qui est interdit',
        blocks: [
          [
            'Les copies piratées de jeux, et les jeux pour adultes (contenu pornographique).',
            'Les jeux d’argent avec de l’argent réel.',
            'Le harcèlement, les menaces, les propos haineux ou discriminatoires, dans le chat comme en jeu.',
            'Toute activité illégale, et tout contenu impliquant des mineurs de façon inappropriée.',
            'Tricher ou perturber une partie pour nuire aux autres joueurs.',
          ],
        ],
      },
      {
        title: 'Signalements et décisions',
        blocks: [
          'Chacun peut signaler une partie ou une personne depuis la partie. Les signalements sont examinés par l’équipe de modération, qui peut fermer une partie ou suspendre un compte. Chaque décision est enregistrée avec sa raison, que la personne concernée peut demander.',
          contactFr ?? '',
        ],
      },
      {
        title: 'Changements',
        blocks: [
          'Ces conditions peuvent évoluer. La date en haut de page indique la dernière version.',
        ],
      },
    ],
  },
  en: {
    title: 'Terms of use',
    updated: 'Updated on 19 November 2026',
    sections: [
      {
        title: 'The service',
        blocks: [
          'Couchwarp lets one person, the host, share the window of a game running on their computer, and lets guests play it from a browser. The service is free and provided as is, with no guarantee of availability.',
          PUBLISHER ? `Couchwarp is run by ${PUBLISHER}.` : '',
        ],
      },
      {
        title: 'Age',
        blocks: ['You must be 13 or over to create an account.'],
      },
      {
        title: 'What the host agrees to',
        blocks: [
          [
            'Share only a game window, never their desktop, files or personal information.',
            'Own the shared game legally and respect its licence.',
            'Stay in charge of the game: remove or ban anyone who breaks these rules.',
          ],
        ],
      },
      {
        title: 'What is not allowed',
        blocks: [
          [
            'Pirated copies of games, and adult games (pornographic content).',
            'Gambling with real money.',
            'Harassment, threats, hateful or discriminatory speech, in the chat or in the game.',
            'Any illegal activity, and any content involving minors inappropriately.',
            'Cheating or disrupting a game to hurt other players.',
          ],
        ],
      },
      {
        title: 'Reports and decisions',
        blocks: [
          'Anyone can report a game or a person from inside the game. Reports are reviewed by the moderation team, which can close a game or suspend an account. Every decision is recorded with its reason, which the person concerned can ask for.',
          contactEn ?? '',
        ],
      },
      {
        title: 'Changes',
        blocks: ['These terms may change. The date at the top shows the latest version.'],
      },
    ],
  },
}

const PRIVACY: Record<'fr' | 'en', Page> = {
  fr: {
    title: 'Confidentialité',
    updated: 'Mise à jour le 20 novembre 2026',
    sections: [
      {
        title: 'En bref',
        blocks: [
          'Couchwarp garde le moins possible. Il n’y a ni publicité, ni mesure d’audience, ni revente de données. L’image, le son et les commandes du jeu ne sont jamais enregistrés.',
          PUBLISHER ? `Responsable du traitement : ${PUBLISHER}.` : '',
          contactFr ?? '',
        ],
      },
      {
        title: 'Sans compte',
        blocks: [
          [
            'Le pseudo que tu tapes et ton rôle dans la partie : gardés par le salon tant qu’il est ouvert, effacés à sa fermeture.',
            'Une empreinte de ton adresse IP, mélangée au code de la partie : sert aux bannissements dans cette partie seulement, effacée à sa fermeture. L’adresse elle-même n’est pas conservée.',
            'Si tu envoies un signalement : son contenu, et une autre empreinte de ton adresse qui limite le nombre de signalements par heure.',
          ],
        ],
      },
      {
        title: 'Avec un compte',
        blocks: [
          [
            'Ton nom, ton avatar et l’identifiant des comptes Discord ou Google que tu lies. Jamais ton adresse e-mail ni tes messages.',
            'Ce que tu choisis pour ton profil : pseudo, photo (redimensionnée avant l’envoi), couleur. Et ton tag, le numéro qui permet à tes amis de t’ajouter. Supprimés avec le compte.',
            'Tes sessions de connexion : 30 jours sur le site, 90 jours dans l’application hôte.',
            'Ton historique de parties (code, nom de la partie, jeu, hôte, heure) : 1 an.',
            'Tes amis, tes demandes d’ami et ce que tu permets à chaque ami dans tes parties (clavier, souris). Une demande sans réponse est supprimée après 90 jours.',
            'La date à laquelle tu as confirmé avoir 13 ans ou plus.',
          ],
        ],
      },
      {
        title: 'Ce que voient les autres',
        blocks: [
          'Pour jouer sans délai, ton navigateur se connecte directement au PC de l’hôte : l’hôte et toi pouvez alors voir l’adresse IP de l’autre, comme dans tout jeu en ligne entre amis. Les invités ne se connectent jamais entre eux et ne voient pas l’adresse des autres invités. Dans une partie publique, ou si l’hôte le choisit, tu passes par le relais : l’hôte ne voit plus ton adresse.',
          'Les joueurs de la partie voient ton pseudo, ton avatar et tes messages. Une partie publique montre à tous son nom, son jeu, le nom de l’hôte, les avatars des joueurs et une petite image du jeu, effacée dès que la partie n’est plus publique.',
        ],
      },
      {
        title: 'Modération',
        blocks: [
          'Les expulsions, bannissements et décisions de modération sont journalisés pendant 1 an. Un signalement traité est gardé 1 an après la décision.',
        ],
      },
      {
        title: 'Prestataires',
        blocks: [
          [
            'Cloudflare héberge le site, les salons, la base de données et le relais réseau.',
            'Discord et Google, seulement si tu te connectes avec eux, selon leurs propres règles.',
          ],
        ],
      },
      {
        title: 'Cookie',
        blocks: [
          'Un seul cookie, celui de ta session quand tu te connectes. Il est nécessaire au service, donc il n’y a pas de bandeau de consentement.',
        ],
      },
      {
        title: 'Tes droits',
        blocks: [
          'Depuis la page Compte, tu peux télécharger toutes tes données et supprimer ton compte : tout est effacé immédiatement. Pour toute autre demande (rectification, opposition, question), écris au contact ci-dessus. Tu peux aussi saisir la CNIL (cnil.fr).',
        ],
      },
    ],
  },
  en: {
    title: 'Privacy',
    updated: 'Updated on 20 November 2026',
    sections: [
      {
        title: 'In short',
        blocks: [
          'Couchwarp keeps as little as it can. There are no ads, no analytics and no data sold. The game’s picture, sound and controls are never recorded.',
          PUBLISHER ? `Data controller: ${PUBLISHER}.` : '',
          contactEn ?? '',
        ],
      },
      {
        title: 'Without an account',
        blocks: [
          [
            'The name you type and your role in the game: kept by the room while it is open, erased when it closes.',
            'A fingerprint of your IP address, mixed with the game code: used for bans in that game only, erased when it closes. The address itself is not kept.',
            'If you send a report: its content, and another fingerprint of your address that limits reports per hour.',
          ],
        ],
      },
      {
        title: 'With an account',
        blocks: [
          [
            'Your name, your avatar and the ids of the Discord or Google accounts you link. Never your email address or your messages.',
            'What you choose for your profile: name, picture (resized before it is sent), colour. And your tag, the number friends add you with. Deleted with the account.',
            'Your sign-in sessions: 30 days on the site, 90 days in the host app.',
            'Your game history (code, game name, game, host, time): 1 year.',
            'Your friends, friend requests and what you let each friend use in your games (keyboard, mouse). An unanswered request is deleted after 90 days.',
            'The date you confirmed being 13 or over.',
          ],
        ],
      },
      {
        title: 'What others see',
        blocks: [
          'To play without delay, your browser connects straight to the host’s PC: you and the host can then see each other’s IP address, as in any online game between friends. Guests never connect to each other and do not see other guests’ addresses. In a public game, or when the host chooses so, you go through the relay: the host no longer sees your address.',
          'Players in the game see your name, avatar and messages. A public game shows everyone its name, its game, the host’s name, the players’ avatars and a small picture of the game, erased as soon as the game stops being public.',
        ],
      },
      {
        title: 'Moderation',
        blocks: [
          'Kicks, bans and moderation decisions are logged for 1 year. A handled report is kept 1 year after the decision.',
        ],
      },
      {
        title: 'Providers',
        blocks: [
          [
            'Cloudflare hosts the site, the rooms, the database and the network relay.',
            'Discord and Google, only if you sign in with them, under their own rules.',
          ],
        ],
      },
      {
        title: 'Cookie',
        blocks: [
          'One cookie only, your session when you sign in. It is needed for the service, so there is no consent banner.',
        ],
      },
      {
        title: 'Your rights',
        blocks: [
          'From the Account page you can download all your data and delete your account: everything is erased at once. For anything else (correction, objection, questions), write to the contact above. You can also complain to your data protection authority.',
        ],
      },
    ],
  },
}

export function Legal({ page }: { page: 'terms' | 'privacy' }) {
  const content = (page === 'terms' ? TERMS : PRIVACY)[lang]
  return (
    <Shell onBack={() => navigate('/')}>
      <article className="page legal" data-width="narrow">
        <h1 className="page__title">{content.title}</h1>
        <p className="legal__updated">{content.updated}</p>
        {content.sections.map((section) => (
          <section key={section.title} className="legal__section">
            <h2 className="section__title">{section.title}</h2>
            {section.blocks
              .filter((block) => block.length > 0)
              .map((block) =>
                typeof block === 'string' ? (
                  <p key={block}>{block}</p>
                ) : (
                  <ul key={block[0]}>
                    {block.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ),
              )}
          </section>
        ))}
      </article>
    </Shell>
  )
}
