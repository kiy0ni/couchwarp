import type { EndReason } from './lib/session'

const fr = {
  wordmark: 'Couchwarp, accueil',
  home: {
    title: 'Rejoindre une partie',
    codeLabel: 'Code de la partie',
    codeHelp: 'Six caractères, affichés chez la personne qui lance le jeu.',
    gamepadHelp:
      'À la manette : haut et bas changent la lettre, gauche et droite changent de case.',
    join: 'Rejoindre',
    looking: 'Recherche…',
    notFound: 'Aucune partie ouverte avec ce code. Vérifie-le avec l’hôte.',
    incomplete: 'Il manque des caractères : le code en compte six.',
    serverDown: 'Le serveur ne répond pas. Réessaie dans un instant.',
  },
  join: {
    title: (code: string) => `Partie ${code}`,
    nameLabel: 'Ton pseudo',
    nameHelp: 'Les autres joueurs le voient.',
    deviceTitle: 'Ton appareil',
    browserOk: 'Navigateur compatible',
    browserMissing:
      'Ce navigateur ne gère pas WebRTC. Ouvre le lien dans Chrome, Edge, Firefox ou Safari.',
    videoHardware: 'Vidéo décodée par la puce graphique',
    videoSoftware: 'Vidéo décodée par le processeur : l’image peut saccader.',
    videoChecking: 'Test du décodage vidéo…',
    noPad:
      'Aucune manette détectée. Appuie sur un de ses boutons pour la réveiller, ou joue au clavier.',
    pad: (slot: number, name: string) => `Manette ${slot} : ${name}`,
    play: 'Jouer',
    back: 'Changer de code',
  },
  play: {
    waiting: 'En attente de l’image…',
    latency: 'Latence',
    paused: 'L’hôte a quitté la fenêtre du jeu. Ton clavier reprend quand il y revient.',
    menu: 'Menu',
    closeMenu: 'Fermer le menu',
    fullscreen: 'Plein écran',
    leave: 'Quitter la partie',
    player: (slot: number) => `Joueur ${slot}`,
    measuresTitle: 'Mesures',
    measuresMedian: 'Latence image, médiane',
    measuresP95: 'Latence image, 95 % des images',
    measuresRoundTrip: 'Aller-retour réseau',
    measuresFps: 'Images par seconde',
    measuresSize: 'Résolution',
    measuresUnknown:
      'Ce navigateur ne donne pas l’heure de capture des images : latence image inconnue.',
  },
  ended: {
    title: 'Partie terminée',
    again: 'Rejoindre une autre partie',
    reasons: {
      'room-not-found': 'Cette partie est fermée.',
      'room-full': 'La partie est complète : huit joueurs au maximum.',
      'invalid-name': 'Choisis un pseudo de 1 à 24 caractères.',
      'host-already-connected': 'Cette partie a déjà un hôte.',
      'host-left': 'L’hôte a fermé la partie.',
      'connection-failed':
        'Impossible de joindre le PC de l’hôte. Son réseau ou le tien bloque peut-être les connexions directes.',
      'server-unreachable': 'Le serveur ne répond pas. Vérifie ta connexion.',
    } satisfies Record<EndReason, string>,
  },
}

type Strings = typeof fr

const en: Strings = {
  wordmark: 'Couchwarp, home',
  home: {
    title: 'Join a game',
    codeLabel: 'Game code',
    codeHelp: 'Six characters, shown by the person running the game.',
    gamepadHelp: 'With a controller: up and down change the letter, left and right change the box.',
    join: 'Join',
    looking: 'Looking…',
    notFound: 'No open game with this code. Check it with the host.',
    incomplete: 'Some characters are missing: the code has six.',
    serverDown: 'The server is not answering. Try again in a moment.',
  },
  join: {
    title: (code) => `Game ${code}`,
    nameLabel: 'Your name',
    nameHelp: 'The other players see it.',
    deviceTitle: 'Your device',
    browserOk: 'Browser supported',
    browserMissing: 'This browser has no WebRTC. Open the link in Chrome, Edge, Firefox or Safari.',
    videoHardware: 'Video decoded by the graphics chip',
    videoSoftware: 'Video decoded by the processor: the picture may stutter.',
    videoChecking: 'Testing video decoding…',
    noPad: 'No controller found. Press one of its buttons to wake it, or play with the keyboard.',
    pad: (slot, name) => `Controller ${slot}: ${name}`,
    play: 'Play',
    back: 'Change code',
  },
  play: {
    waiting: 'Waiting for the picture…',
    latency: 'Latency',
    paused: 'The host left the game window. Your keyboard comes back when they return.',
    menu: 'Menu',
    closeMenu: 'Close menu',
    fullscreen: 'Full screen',
    leave: 'Leave the game',
    player: (slot) => `Player ${slot}`,
    measuresTitle: 'Measures',
    measuresMedian: 'Picture latency, median',
    measuresP95: 'Picture latency, 95% of frames',
    measuresRoundTrip: 'Network round trip',
    measuresFps: 'Frames per second',
    measuresSize: 'Resolution',
    measuresUnknown:
      'This browser does not report when frames were captured: picture latency unknown.',
  },
  ended: {
    title: 'Game over',
    again: 'Join another game',
    reasons: {
      'room-not-found': 'This game is closed.',
      'room-full': 'The game is full: eight players at most.',
      'invalid-name': 'Pick a name of 1 to 24 characters.',
      'host-already-connected': 'This game already has a host.',
      'host-left': 'The host closed the game.',
      'connection-failed':
        'Could not reach the host’s PC. Their network or yours may block direct connections.',
      'server-unreachable': 'The server is not answering. Check your connection.',
    },
  },
}

export const lang = navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en'
export const t: Strings = lang === 'fr' ? fr : en
