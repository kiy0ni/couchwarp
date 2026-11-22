# Architecture

État au jalon 1, parties complètes. Le projet visé est décrit dans [CAHIER-DES-CHARGES.md](CAHIER-DES-CHARGES.md).

## Les trois programmes

```
 PC de l'hôte                         Cloudflare                      Navigateur de l'invité
┌──────────────────────┐          ┌──────────────────┐            ┌─────────────────────────┐
│ couchwarp-host (Rust)│◄─WebSocket─►  Worker + 1     │◄─WebSocket─►  apps/web (React)       │
│                      │  négociation  Durable Object │  négociation                        │
│ capture → encodeur   │          │  par salon       │            │                         │
│ str0m (WebRTC)       │◄═════════ WebRTC direct (UDP) ═══════════►│ vidéo, manettes, clavier│
│ routeur d'entrées    │          └──────────────────┘            └─────────────────────────┘
└──────────────────────┘
```

Le serveur de salons ne voit passer que la négociation (offres SDP, candidats ICE). L'image, les manettes et le clavier vont directement de l'invité à l'hôte.

## L'application pour Mac, Windows et Linux

`apps/desktop` est une application Tauri. Sa fenêtre affiche le site lui-même (en ligne, ou `localhost:5173` en développement) : les pages sont les mêmes que dans un navigateur, et une seule mise en ligne les met à jour partout. Ce que le navigateur ne sait pas faire passe par des commandes Rust, que seules les pages du site peuvent appeler (`capabilities/site.json`) :

- lister les fenêtres et en prendre un aperçu ;
- lancer et arrêter une session d'hôte, qui tourne sur son propre fil et prévient la page à chaque changement (`hosting`) ;
- se connecter par le navigateur du système, comme l'hôte en ligne de commande. Le jeton obtenu est échangé contre le cookie du site (`POST /api/auth/app-session`), pour que la fenêtre soit connectée elle aussi ;
- se mettre à jour (`src/updates.rs`, extension `tauri-plugin-updater`). L'appli regarde 10 secondes après le démarrage puis toutes les 4 heures, et prévient la page (`update`), qui affiche un bouton vert dans la barre du haut. Le manifeste vient du site (`GET /api/updates/latest.json`), qui lit la dernière version publiée sur GitHub et renvoie vers ses fichiers : le dépôt pourrait redevenir privé sans rien changer aux applis. Paramètres > Application montre la version (`app_version`) et lance une recherche tout de suite (`check_for_update`). Chaque fichier est signé, et l'appli refuse ce que la clé publique de `tauri.conf.json` ne reconnaît pas.

L'interface est en anglais par défaut, en français si le navigateur l'est ou si on le choisit dans les paramètres (`apps/web/src/i18n.ts` ; l'anglais sert de référence, une traduction manquante est une erreur de type). Les adresses des pages sont en anglais ; celles des versions précédentes, en français, redirigent (`lib/router.ts`).

L'hôte est une bibliothèque (`crates/host/src/lib.rs`) : `session::run` prend une fenêtre, des réglages et un signal d'arrêt, et rend compte par des événements (salon ouvert, mesures, autorisations manquantes). La ligne de commande et l'application l'appellent de la même façon.

La page d'une partie en cours réutilise la console de l'hôte (`RoomManager`) : la clé de console n'a pas besoin de passer par un lien, l'application la donne directement.

Côté client web, `lib/desktop.ts` détecte l'application et regroupe ses commandes ; rien n'y est appelé dans un navigateur.

## Rejoindre une partie

1. L'hôte ouvre un WebSocket sur `/api/host`. Le Worker tire un code de six caractères, crée le salon (un Durable Object nommé par ce code) et renvoie `room-created`.
2. L'invité tape le code. Le client vérifie le salon (`GET /api/rooms/:code`), puis ouvre `/api/rooms/:code/guest?name=`. Le salon répond `welcome`, avec les serveurs ICE (STUN, et TURN si une clé Cloudflare est configurée), et prévient l'hôte (`guest-joined`).
3. L'invité crée la connexion WebRTC : une piste vidéo en réception (H.264 constrained baseline uniquement), un canal `control` fiable et un canal `input` non fiable et non ordonné. Il envoie son offre.
4. L'hôte crée un `Peer` str0m, répond avec son adresse locale et son adresse publique (trouvée par STUN au démarrage). Les candidats de l'invité suivent au fil de l'eau, et l'hôte les teste lui-même : derrière le relais, c'est lui qui doit écrire le premier, sinon sa box rejette les paquets du relais.
5. À l'ouverture du canal `control`, l'hôte envoie l'horloge du flux et force une image clé.

str0m n'avance que quand on lui donne l'heure. La boucle de l'hôte (`host.rs`) le réveille à l'échéance qu'il demande, et au plus tard 100 ms après le dernier réveil. Ce délai compte depuis le dernier réveil, pas depuis maintenant : les images et le son arrivent toutes les quelques millisecondes, et un délai recompté à chaque fois n'arriverait jamais. C'était le cas jusqu'à la 0.2.4 : une connexion neuve ne lançait jamais ses vérifications, et un invité derrière le relais ne pouvait pas se connecter.

## L'état d'un salon

Le Durable Object du salon tient l'état complet (`RoomState` : réglages, membres et rôles, file d'attente, fin du tour) et toutes les règles qui le modifient, dans un modèle pur (`services/edge/src/room-model.ts`) testé sans réseau. Après chaque changement, il envoie l'état entier à l'hôte, aux invités et aux consoles ; personne ne le recalcule.

- **Commandes** (`HostCommand`) : réglages, rôle, permissions, type de manette, expulsion et bannissement, tour suivant, chat, fermeture. L'hôte (application ou console) peut tout ; un modérateur peut déplacer et expulser les joueurs, pas les autres modérateurs ; un joueur choisit seulement son type de manette. Chaque action de modération est journalisée en base (`moderation_log`).
- **Console** : une page web authentifiée par la clé du lien (`room-created` la donne à l'hôte). La clé est dans le fragment `#`, que le navigateur n'envoie jamais à un serveur ; le salon la compare par empreinte SHA-256.
- **Bannissement** : par compte et par empreinte de l'adresse IP salée avec le code du salon. L'adresse elle-même n'est jamais stockée.
- **La porte** : par défaut, une personne qui arrive attend l'accord de l'hôte (`admission: 'ask'`) ; l'hôte peut aussi laisser entrer ses amis, ou tout le monde. À la porte, l'invité ne reçoit ni serveurs ICE, ni état de la salle, ni chat, et ne peut rien envoyer : la salle lui envoie `waiting`, puis `welcome` une fois accepté, ou `rejected` (`refused`). Les demandes s'affichent en haut de la console et, dans l'appli, dans un bandeau que la pastille déplie quelques secondes (`set_bubble_notice`) sans ouvrir son panneau par-dessus le jeu.
- **Relais seul** : avec `relayOnly` (par défaut quand le serveur a un relais, toujours dans une partie publique), l'invité ne collecte que des candidats TURN, donc l'hôte et les autres invités ne voient jamais son adresse. Le relais est celui de Cloudflare ou un coturn à soi (`services/edge/src/ice.ts`).
- **Parties publiques** : un salon public est écrit dans la table `rooms` de D1 et rafraîchi chaque minute par une alarme ; une ligne de plus de deux minutes disparaît de la liste. Seul un hôte connecté à un compte peut lister sa partie : `couchwarp-host login` passe par la page de connexion du site, qui renvoie un jeton de session sur une page locale de l'hôte (`127.0.0.1`, chemin aléatoire) ; l'hôte le présente ensuite en `Authorization: Bearer`.
- **Aperçu** : tant que la partie est publique, la capture réduit une image toutes les 10 secondes à 320 pixels de large et l'envoie en JPEG, en message binaire, au salon. Le salon n'accepte qu'un JPEG de moins de 128 Ko et ne le sert que tant que la partie est publique.

L'hôte applique ce qu'il reçoit dans son routeur d'entrées : un spectateur n'envoie rien au jeu, et le clavier d'un invité n'y arrive que si l'hôte l'a autorisé (`Permissions`).

## Ce qui dépend du système

Le dossier `crates/host/src/platform` contient un module par système, qui exposent les mêmes noms. Le reste de l'hôte ne sait pas sur quel système il tourne.

|                       | macOS                                                                            | Windows                                                                                           | Linux                                                                                            |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Capture de la fenêtre | ScreenCaptureKit, NV12, mise à l'échelle                                         | Windows Graphics Capture, BGRA, taille de la fenêtre, sans bordure jaune                          | X11 en mémoire partagée (MIT-SHM, x11rb), BGRA, curseur dessiné (XFixes) ; XWayland sous Wayland |
| Encodage H.264        | VideoToolbox matériel, contrôle de débit basse latence                           | Media Foundation sur la carte graphique (`platform/windows/hardware.rs`), OpenH264 logiciel sinon | OpenH264 logiciel (`platform/openh264.rs`)                                                       |
| Son                   | ScreenCaptureKit, application de la fenêtre                                      | WASAPI process loopback, jeu et processus enfants                                                 | `parec --monitor-stream`, flux du jeu et de ses processus enfants                                |
| Clavier et souris     | CGEvent envoyé au seul processus du jeu (ou au système, option « vrai curseur ») | SendInput par scancodes, curseur confiné (`ClipCursor`)                                           | un clavier-souris virtuel `uinput`, curseur confiné (barrières XFixes)                           |
| Manettes              | jouées au clavier, joueurs 1 et 2 (`pad_keys.rs`)                                | VIIPER, une manette Xbox 360 virtuelle par place                                                  | `uinput`, une manette Xbox 360 par place, comme le pilote `xpad`                                 |
| Premier plan          | liste des fenêtres à l'écran                                                     | `GetForegroundWindow`                                                                             | `_NET_ACTIVE_WINDOW` et `_NET_WM_PID`                                                            |
| Cryptographie WebRTC  | aws-lc                                                                           | CNG de Windows                                                                                    | aws-lc                                                                                           |

Les tables de traduction (touche HID vers code de touche Mac, vers scancode PC, vers code Linux, état de manette vers rapport Xbox ou événements Linux) et la lecture de `pactl` sont des fonctions pures, testées sur tous les systèmes. La capture Linux a en plus un test qui ouvre une fenêtre sur un serveur X virtuel (Xvfb) en intégration continue.

L'encodeur matériel de Windows prend la première carte que Media Foundation propose, réglée pour la latence (débit constant, mode basse latence, sans image B, image clé à la demande). Il reçoit l'image en NV12, convertie depuis le BGRA de la capture (`nv12.rs`), et rend chaque image dès qu'elle est prête, sans fil d'exécution à lui. S'il n'y en a pas, ou s'il échoue en cours de partie (pilote réinitialisé), OpenH264 prend le relais pour le reste de la partie. L'intégration continue tourne sur des machines sans carte graphique : c'est le chemin logiciel qu'elle vérifie, l'encodeur matériel se vérifie sur un vrai PC (l'hôte en ligne de commande de chaque passage y est gardé sept jours).

Quand la fenêtre du jeu se ferme, `session.rs` garde la partie ouverte : les invités l'apprennent (`game-closed` sur le canal de contrôle), et toutes les secondes l'hôte cherche une fenêtre du même programme. Il la partage dès qu'elle apparaît, avec le même encodeur et les mêmes connexions. L'appli connaît le programme du jeu (`game.rs`) et propose de le relancer. Après 15 minutes sans jeu, la partie se ferme.

L'hôte ouvre une socket sur l'adresse de la route par défaut (celle que la box traduit, trouvée par STUN), puis une sur chacune de ses autres adresses, IPv6 et VPN compris (`net.rs`) ; str0m dit de quelle adresse partir pour chaque paquet.

## Le parcours d'une image

| Étape      | Où                            | Détail                                                                                                                        |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Capture    | `platform/macos/capture.rs`   | ScreenCaptureKit, fenêtre du jeu seule, NV12, 4 tampons au plus                                                               |
| Encodage   | `platform/macos/encoder.rs`   | VideoToolbox matériel, temps réel, contrôle de débit basse latence, pas de réordonnancement, image clé seulement à la demande |
| Conversion | `video.rs`                    | Unités NAL préfixées par leur longueur vers Annex B, SPS/PPS devant chaque image clé                                          |
| Envoi      | `peer.rs`                     | str0m découpe en paquets RTP, une seule copie de l'image partagée entre tous les invités                                      |
| Affichage  | `apps/web/src/lib/session.ts` | Tampon de gigue réglé à 0, décodage matériel du navigateur                                                                    |

File pleine (réseau en retard) : l'image est jetée plutôt que mise en attente, et la suivante est une image clé. La latence reste stable, au prix d'une image perdue.

Une fenêtre immobile n'envoie aucune image : ScreenCaptureKit et Windows Graphics Capture ne livrent une image que quand elle change. Un menu, un écran de pause ou un lanceur ne change pas, et un invité qui arrive à ce moment attendrait sa première image clé indéfiniment (« En attente de l'image »). L'encodeur garde donc la dernière image (le tampon NV12 sur Mac, l'image YUV d'OpenH264 sous Windows et Linux). Quand une image clé est demandée et que la fenêtre n'a rien envoyé depuis 100 ms, il la ré-encode (`repeat_if_still`, appelé toutes les 50 ms par `session.rs`). Une image clé qu'OpenH264 saute pour tenir son débit reste due à la suivante.

## Le son

ScreenCaptureKit capture le son de l'application qui possède la fenêtre partagée (jamais celui de Couchwarp), en 48 kHz stéréo. `audio.rs` le découpe en paquets de 10 ms (deux fois plus courts que d'habitude, pour deux fois moins d'attente) et l'encode en Opus à 128 kbit/s. L'invité le lit dans le même élément `<video>` que l'image. Si le navigateur refuse de démarrer le son sans clic, l'image démarre en muet et un bouton « Activer le son » apparaît.

Mesuré en local : image toujours à 24 ms en médiane avec le son actif (le navigateur ne retarde pas l'image pour la synchroniser), son à environ 80 ms dans le tampon du navigateur.

## Le parcours d'une touche

1. Le navigateur lit les manettes toutes les 4 ms et le clavier à chaque événement, et envoie **l'état complet** de l'appareil. Trois sources donnent une manette : les manettes physiques (numéros 0 à 3), le clavier joué comme une manette (4) et la manette tactile (5). Ces deux dernières ne prennent une place de joueur qu'au premier usage. Le clavier peut aussi être envoyé tel quel (« touches du jeu ») ; c'est le choix par défaut quand l'hôte annonce (`host-info`) qu'il ne sait pas jouer les manettes (format binaire, `crates/protocol/src/input.rs`). Un état est renvoyé tous les 100 ms même sans changement : un paquet perdu ne laisse jamais une touche enfoncée.
2. L'hôte décode, écarte les paquets en retard (numéro de séquence sur 16 bits, qui reboucle), puis passe tout au routeur (`input/mod.rs`) :
   - un invité n'agit que selon ses permissions, que l'hôte change pour chacun : rien pour un spectateur ; pour un joueur, la manette (permise à l'arrivée), le clavier et la souris (sur autorisation) ;
   - chaque manette reçoit la première place libre de 1 à 8, annoncée à l'invité. Sous Windows et Linux, la manette virtuelle de chaque place est branchée dès qu'un joueur est connecté, avant qu'il appuie sur quoi que ce soit, et reste branchée jusqu'à la fin de la partie, au repos entre deux joueurs : un émulateur ou un jeu qui associe un joueur à une manette peut la choisir d'avance et la garde ;
   - le bouton Guide est retiré ;
   - les touches passent par le filtre (`input/filter.rs`) : Windows/Cmd, Impr. écran, Alt+Tab, Alt+F4, Ctrl+Échap, etc. ne sont jamais envoyées ;
   - les touches de tous les invités sont réunies : une touche reste enfoncée tant qu'un invité la tient ;
   - si la fenêtre du jeu n'est plus au premier plan, toutes les touches sont relâchées et les invités sont prévenus (`input-paused`), l'hôte aussi. Sur Mac, où les touches ne vont qu'au processus du jeu, les fenêtres de Couchwarp au premier plan (pastille, chat) ne comptent pas ; sous Windows et Linux, la pastille ne peut pas prendre le premier plan.
3. Sur macOS, les touches sont envoyées **au seul processus du jeu** (`CGEventPostToPid`), jamais au système.

## La souris

Le paquet souris porte le mouvement relatif depuis le paquet précédent, la molette, et l'état complet des boutons. Le routeur ne le laisse passer que si l'hôte a autorisé la souris de l'invité et que le jeu est au premier plan. Les boutons de tous les invités sont réunis, comme les touches. Sur Mac, les événements sont postés au seul processus du jeu, avec un pointeur virtuel gardé dans sa fenêtre. Sous Windows, SendInput déplace le vrai curseur : il est confiné à la fenêtre du jeu (`ClipCursor`), confinement vérifié avant chaque événement car Windows l'annule au moindre changement de premier plan, et libéré dès que le jeu passe derrière. Sous Linux, la souris virtuelle `uinput` déplace aussi le vrai curseur, sans confinement pour l'instant ; ses boutons sont relâchés dès que le jeu passe derrière.

La pastille de l'invité ouvre son menu juste à côté d'elle : vers le bas si elle est dans la moitié haute de l'écran, vers le haut sinon, centré sur elle sans dépasser les bords (`apps/web/src/lib/bubble-menu.ts`). Celle de l'hôte, une petite fenêtre au-dessus du jeu, fait de même à l'échelle de l'écran (`apps/desktop/src-tauri/src/bubble.rs`) et remet la pastille dans le coin d'où le panneau s'est ouvert.

## La qualité qui s'adapte

Chaque seconde, l'invité envoie sur le canal `control` sa perte de paquets vidéo (d'après `getStats`) et sa latence image au 95e centile (`quality`). L'hôte (`bitrate.rs`) baisse de 20 % la part d'un invité qui perd plus de 2 % des paquets ou dont la latence dépasse de 40 ms son meilleur niveau, au plus une fois par seconde. Il la remonte de 10 % après 4 secondes sans problème. L'encodeur, unique, suit l'invité le moins bien servi, sans descendre sous 1,5 Mbit/s ni dépasser `--bitrate`. Le changement s'applique à l'image suivante, sans image clé. L'estimation de bande passante de str0m (TWCC) n'est pas utilisée : elle lisse l'envoi des paquets, ce qui a fait passer la latence locale de 28 à 126 ms à l'essai.

## Profils, amis et jeux reconnus

- **Profil** (`services/edge/src/profiles.ts`) : pseudo, photo et couleur choisis par la personne. La photo est recadrée et réduite à 256 px dans le navigateur, puis vérifiée par ses octets (JPEG, PNG, WebP) et gardée en D1. Les **badges** se calculent à la demande depuis l'historique, les amis et la liste de l'équipe ; rien n'est stocké.
- **Tag** : un numéro à six chiffres par compte. Un ami s'ajoute par `Pseudo#123456`, nom et numéro ensemble, ou depuis la liste des joueurs d'une partie jouée ensemble. Pas de recherche par nom.
- **Permissions par ami** : l'hôte choisit pour chaque ami le clavier et la souris dès son arrivée (`friend_permissions`), comme les permissions par défaut de Parsec.
- **Jeux reconnus** (`services/edge/src/games.ts`) : le nom d'une fenêtre ou celui tapé par l'hôte est cherché dans la boutique Steam (correspondance exacte, ou titre de fenêtre qui commence par le nom du jeu). Résultat et absence de résultat sont gardés en D1 (30 et 7 jours). Les pages affichent la jaquette, ou une jaquette générique.

## Manettes et gyroscope

Le navigateur lit les manettes par l'API Gamepad. Les manettes Nintendo, PlayStation et Xbox sont reconnues par leur identifiant ; une manette Nintendo peut suivre ses lettres (A à droite) plutôt que ses positions. Le gyroscope vient d'une manette PlayStation ou Switch lue par WebHID (Chrome, Edge), ou du téléphone avec la manette tactile. Il part dans un paquet `motion` (16 octets, unités d'une DualShock 4) que l'hôte Windows met dans sa DualShock 4 virtuelle.

## Comptes, amis et modération

- **Amis** : une demande exige une partie jouée ensemble (même code dans l'historique). La présence vient de l'historique ouvert ; le code n'est montré que si la partie est publique.
- **Signalements** : `POST /api/rooms/:code/report`, cinq par heure et par réseau. Le salon dit au Worker le nom et le compte de la personne visée (route interne `facts`). Les admins (`ADMIN_USER_IDS`) décident sur `/moderation` : classer, fermer la partie (route interne `admin-close`) ou suspendre le compte (sessions supprimées). Chaque décision exige une raison et entre au journal.
- **Nettoyage** : une tâche planifiée applique chaque nuit les durées de la page Confidentialité (`cleanup.ts`).

## Mesure de la latence

L'hôte numérote ses images en RTP à 90 kHz depuis une origine dont il donne l'heure Unix (`stream-clock`). Le navigateur compare l'heure de capture déduite du timestamp RTP de chaque image affichée (`requestVideoFrameCallback`) avec l'heure d'affichage, corrigée du décalage d'horloge mesuré par ping sur le canal `control`. Le résultat (médiane et 95e centile sur 5 secondes) s'affiche dans la barre en jeu et dans le menu « Mesures ». L'hôte journalise de son côté le temps de la capture à l'envoi.

## Protocole partagé

Le protocole existe en Rust (`crates/protocol`) et en TypeScript (`packages/protocol`). Les exemples de `fixtures/protocol` sont la référence : les deux suites de tests les relisent et doivent produire les mêmes octets.

## Prochaines étapes

- Premier test de l'hôte Windows sur un vrai PC, avec VIIPER, la souris et la manette PlayStation ; premier test de l'hôte Linux sur un vrai bureau.
- Encodeurs matériels sous Windows (NVENC, AMF, Quick Sync) et Linux (VA-API) ; capture Linux par mémoire partagée (MIT-SHM) ou par le portail de partage d'écran pour les fenêtres Wayland natives.
- Signature des applications (certificat Apple, certificat Windows) pour éviter les avertissements à l'installation.
- Mesure de latence entre deux réseaux différents, avec relai TURN, une fois le site en ligne.
