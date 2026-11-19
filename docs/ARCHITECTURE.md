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

## Rejoindre une partie

1. L'hôte ouvre un WebSocket sur `/api/host`. Le Worker tire un code de six caractères, crée le salon (un Durable Object nommé par ce code) et renvoie `room-created`.
2. L'invité tape le code. Le client vérifie le salon (`GET /api/rooms/:code`), puis ouvre `/api/rooms/:code/guest?name=`. Le salon répond `welcome`, avec les serveurs ICE (STUN, et TURN si une clé Cloudflare est configurée), et prévient l'hôte (`guest-joined`).
3. L'invité crée la connexion WebRTC : une piste vidéo en réception (H.264 constrained baseline uniquement), un canal `control` fiable et un canal `input` non fiable et non ordonné. Il envoie son offre.
4. L'hôte crée un `Peer` str0m, répond avec son adresse locale et son adresse publique (trouvée par STUN au démarrage). Les candidats de l'invité suivent au fil de l'eau.
5. À l'ouverture du canal `control`, l'hôte envoie l'horloge du flux et force une image clé.

## L'état d'un salon

Le Durable Object du salon tient l'état complet (`RoomState` : réglages, membres et rôles, file d'attente, fin du tour) et toutes les règles qui le modifient, dans un modèle pur (`services/edge/src/room-model.ts`) testé sans réseau. Après chaque changement, il envoie l'état entier à l'hôte, aux invités et aux consoles ; personne ne le recalcule.

- **Commandes** (`HostCommand`) : réglages, rôle, permissions, type de manette, expulsion et bannissement, tour suivant, chat, fermeture. L'hôte (application ou console) peut tout ; un modérateur peut déplacer et expulser les joueurs, pas les autres modérateurs ; un joueur choisit seulement son type de manette. Chaque action de modération est journalisée en base (`moderation_log`).
- **Console** : une page web authentifiée par la clé du lien (`room-created` la donne à l'hôte). La clé est dans le fragment `#`, que le navigateur n'envoie jamais à un serveur ; le salon la compare par empreinte SHA-256.
- **Bannissement** : par compte et par empreinte de l'adresse IP salée avec le code du salon. L'adresse elle-même n'est jamais stockée.
- **Relais seul** : avec `relayOnly`, l'invité ne collecte que des candidats TURN, donc l'hôte et les autres invités ne voient jamais son adresse.
- **Parties publiques** : un salon public est écrit dans la table `rooms` de D1 et rafraîchi chaque minute par une alarme ; une ligne de plus de deux minutes disparaît de la liste. Seul un hôte connecté à un compte peut lister sa partie : `couchwarp-host login` passe par la page de connexion du site, qui renvoie un jeton de session sur une page locale de l'hôte (`127.0.0.1`, chemin aléatoire) ; l'hôte le présente ensuite en `Authorization: Bearer`.
- **Aperçu** : tant que la partie est publique, la capture réduit une image toutes les 10 secondes à 320 pixels de large et l'envoie en JPEG, en message binaire, au salon. Le salon n'accepte qu'un JPEG de moins de 128 Ko et ne le sert que tant que la partie est publique.

L'hôte applique ce qu'il reçoit dans son routeur d'entrées : un spectateur n'envoie rien au jeu, et le clavier d'un invité n'y arrive que si l'hôte l'a autorisé (`Permissions`).

## Ce qui dépend du système

Le dossier `crates/host/src/platform` contient un module par système, qui exposent les mêmes noms. Le reste de l'hôte ne sait pas sur quel système il tourne.

|                       | macOS                                                  | Windows                                                                  |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Capture de la fenêtre | ScreenCaptureKit, NV12, mise à l'échelle               | Windows Graphics Capture, BGRA, taille de la fenêtre, sans bordure jaune |
| Encodage H.264        | VideoToolbox matériel, contrôle de débit basse latence | OpenH264 logiciel (le matériel viendra par Media Foundation)             |
| Son                   | ScreenCaptureKit, application de la fenêtre            | WASAPI process loopback, jeu et processus enfants                        |
| Clavier               | CGEvent envoyé au seul processus du jeu                | SendInput par scancodes                                                  |
| Manettes              | impossibles (aucune manette virtuelle autorisée)       | VIIPER, une manette Xbox 360 virtuelle par place                         |
| Premier plan          | liste des fenêtres à l'écran                           | `GetForegroundWindow`                                                    |
| Cryptographie WebRTC  | aws-lc                                                 | CNG de Windows                                                           |

Les tables de traduction (touche HID vers code de touche Mac, vers scancode PC, état de manette vers rapport Xbox) sont des fonctions pures, testées sur tous les systèmes.

## Le parcours d'une image

| Étape      | Où                            | Détail                                                                                                                        |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Capture    | `platform/macos/capture.rs`   | ScreenCaptureKit, fenêtre du jeu seule, NV12, 3 tampons au plus                                                               |
| Encodage   | `platform/macos/encoder.rs`   | VideoToolbox matériel, temps réel, contrôle de débit basse latence, pas de réordonnancement, image clé seulement à la demande |
| Conversion | `video.rs`                    | Unités NAL préfixées par leur longueur vers Annex B, SPS/PPS devant chaque image clé                                          |
| Envoi      | `peer.rs`                     | str0m découpe en paquets RTP, une seule copie de l'image partagée entre tous les invités                                      |
| Affichage  | `apps/web/src/lib/session.ts` | Tampon de gigue réglé à 0, décodage matériel du navigateur                                                                    |

File pleine (réseau en retard) : l'image est jetée plutôt que mise en attente, et la suivante est une image clé. La latence reste stable, au prix d'une image perdue.

## Le son

ScreenCaptureKit capture le son de l'application qui possède la fenêtre partagée (jamais celui de Couchwarp), en 48 kHz stéréo. `audio.rs` le découpe en paquets de 10 ms (deux fois plus courts que d'habitude, pour deux fois moins d'attente) et l'encode en Opus à 128 kbit/s. L'invité le lit dans le même élément `<video>` que l'image. Si le navigateur refuse de démarrer le son sans clic, l'image démarre en muet et un bouton « Activer le son » apparaît.

Mesuré en local : image toujours à 24 ms en médiane avec le son actif (le navigateur ne retarde pas l'image pour la synchroniser), son à environ 80 ms dans le tampon du navigateur.

## Le parcours d'une touche

1. Le navigateur lit les manettes toutes les 4 ms et le clavier à chaque événement, et envoie **l'état complet** de l'appareil. Trois sources donnent une manette : les manettes physiques (numéros 0 à 3), le clavier joué comme une manette (4) et la manette tactile (5). Ces deux dernières ne prennent une place de joueur qu'au premier usage. Le clavier peut aussi être envoyé tel quel (« touches du jeu ») ; c'est le choix par défaut quand l'hôte annonce (`host-info`) qu'il ne sait pas jouer les manettes (format binaire, `crates/protocol/src/input.rs`). Un état est renvoyé tous les 100 ms même sans changement : un paquet perdu ne laisse jamais une touche enfoncée.
2. L'hôte décode, écarte les paquets en retard (numéro de séquence sur 16 bits, qui reboucle), puis passe tout au routeur (`input/mod.rs`) :
   - un invité n'agit que selon ses permissions : rien pour un spectateur, manettes pour un joueur, clavier en plus s'il est autorisé ;
   - chaque manette reçoit la première place libre de 1 à 8, annoncée à l'invité ;
   - le bouton Guide est retiré ;
   - les touches passent par le filtre (`input/filter.rs`) : Windows/Cmd, Impr. écran, Alt+Tab, Alt+F4, Ctrl+Échap, etc. ne sont jamais envoyées ;
   - les touches de tous les invités sont réunies : une touche reste enfoncée tant qu'un invité la tient ;
   - si la fenêtre du jeu n'est plus au premier plan, toutes les touches sont relâchées et les invités sont prévenus (`input-paused`).
3. Sur macOS, les touches sont envoyées **au seul processus du jeu** (`CGEventPostToPid`), jamais au système.

## Mesure de la latence

L'hôte numérote ses images en RTP à 90 kHz depuis une origine dont il donne l'heure Unix (`stream-clock`). Le navigateur compare l'heure de capture déduite du timestamp RTP de chaque image affichée (`requestVideoFrameCallback`) avec l'heure d'affichage, corrigée du décalage d'horloge mesuré par ping sur le canal `control`. Le résultat (médiane et 95e centile sur 5 secondes) s'affiche dans la barre en jeu et dans le menu « Mesures ». L'hôte journalise de son côté le temps de la capture à l'envoi.

## Protocole partagé

Le protocole existe en Rust (`crates/protocol`) et en TypeScript (`packages/protocol`). Les exemples de `fixtures/protocol` sont la référence : les deux suites de tests les relisent et doivent produire les mêmes octets.

## Prochaines étapes

- Premier test de l'hôte Windows sur un vrai PC, avec VIIPER.
- Encodeurs matériels sous Windows (NVENC, AMF, Quick Sync).
- Débit adaptatif : la qualité suit l'estimation de bande passante de chaque invité.
- Mesure de latence entre deux réseaux différents, avec relai TURN, une fois le site en ligne.
