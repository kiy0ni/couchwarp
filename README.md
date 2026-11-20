# Couchwarp

Jouer en multijoueur local à distance. L'hôte partage la fenêtre de son jeu, ses amis le rejoignent depuis un navigateur avec un code à six caractères, sans rien installer, et jouent avec leur manette ou leur clavier.

Couchwarp existe en trois formes : le **site** (rejoindre, parties publiques, amis, paramètres), l'**application pour Mac et Windows** (le site, plus le partage d'une fenêtre de jeu en quelques clics) et l'**hôte en ligne de commande**, pour les serveurs et les tests.

Statut : **jalon 1 en cours**. La chaîne complète fonctionne avec un hôte macOS : image et son du jeu, encodage matériel, WebRTC, client web. Les invités jouent au clavier (touches du jeu ou clavier converti en manette), à la manette, ou avec une manette tactile sur téléphone. Le cahier des charges est dans [docs/CAHIER-DES-CHARGES.md](docs/CAHIER-DES-CHARGES.md), le fonctionnement technique dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Mesures du jalon 0a

Hôte et invité sur un MacBook Air M3, fenêtre de 1728 × 1080 à 60 images par seconde, H.264 matériel à 12 Mbit/s :

| Mesure                                       | Valeur                                       |
| -------------------------------------------- | -------------------------------------------- |
| Capture jusqu'à l'envoi réseau (hôte)        | 8,8 ms en médiane                            |
| Capture jusqu'à l'affichage (invité)         | 28 ms en médiane, 40 ms pour 95 % des images |
| Clic sur « Jouer » jusqu'à la première image | 325 ms                                       |

Ces chiffres sont mesurés en local, sans réseau entre les deux. La mesure sur Internet reste à faire (jalon 0b).

## Lancer en local

Prérequis : Node 22 et pnpm (via mise), Rust stable. L'hôte tourne sur macOS 14 ou plus récent, sur Windows 10 (version 2004) ou plus récent, et sur Linux (x86-64, bureau X11 ou Wayland avec XWayland). Pour compiler l'application sous Linux : `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`.

```sh
pnpm install
pnpm dev                 # serveur de salons sur :8787, client web sur :5173
```

### L'application

Dans un autre terminal, `pnpm desktop:dev` ouvre l'application branchée sur le site local. Sa page **Héberger** liste les fenêtres avec un aperçu ; on en choisit une, on règle la partie (nom, jeu, places, visibilité, image), puis « Lancer la partie ». La même page montre ensuite le code, le lien, les mesures (images par seconde, délai de l'hôte, débit) et toute la console : joueurs, chat, réglages. La connexion à un compte passe par le navigateur du système.

`pnpm desktop:build` produit l'application et son installateur pour le système courant (`.dmg` sur Mac, `.exe` sous Windows, `.AppImage` et `.deb` sous Linux) dans `target/release/bundle`. Pousser une étiquette `v*` les construit tous sur GitHub Actions et publie la version (`.github/workflows/release.yml`, voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)).

L'appli s'appelle Couchwarp dans le Dock et la barre des tâches ; son icône est dans `docs/branding/couchwarp-app.svg`. Pendant une partie, une pastille ronde reste au-dessus du jeu (code, invités, permissions, arrêt) ; la capture ne prend que la fenêtre du jeu, donc les invités ne la voient pas.

L'application affiche le site en ligne (`build.frontendDist` dans `apps/desktop/src-tauri/tauri.conf.json`) : une mise à jour du site lui parvient sans la réinstaller.

### L'hôte en ligne de commande

```sh
cargo run -p couchwarp-host -- --list-windows
cargo run -p couchwarp-host -- --window "nom du jeu"
```

L'hôte affiche le code de la partie, le lien d'invitation, un QR code et le lien de sa **console**. Ouvre le lien d'invitation dans Chrome, Edge ou Arc, choisis un pseudo, puis « Jouer ».

La console (`/<code>/console#key=…`) gère la partie depuis n'importe quel appareil : places de joueur, rôles (modérateur, joueur, spectateur), clavier autorisé ou non pour chaque invité, expulsion et bannissement, tour par tour, chat, fermeture. Garde ce lien pour toi : il donne les droits de l'hôte.

Les réglages de départ peuvent aussi se donner à l'hôte :

```sh
cargo run -p couchwarp-host -- --window "nom du jeu" --game "Overcooked 2" --players 4 --turn-minutes 5
```

| Option           | Effet                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| `--title`        | Nom de la partie                                                                  |
| `--game`         | Jeu affiché dans la liste publique                                                |
| `--players`      | Places de joueur, de 1 à 8 ; les suivants regardent                               |
| `--public`       | Liste la partie dans « Parties publiques » (hôte connecté à un compte)            |
| `--relay-only`   | Tout passe par le relais TURN : personne ne voit l'adresse IP des autres          |
| `--turn-minutes` | Tour par tour minuté : un spectateur en file prend une place toutes les N minutes |

Pour lister une partie publiquement, l'hôte se connecte une fois à un compte : `cargo run -p couchwarp-host -- login` ouvre le navigateur (Discord par défaut, `--provider google` sinon) et garde la session dans le dossier de configuration de l'utilisateur, une par site. `logout` la termine. Une partie publique montre dans la liste une petite image du jeu, prise toutes les 10 secondes ; une partie privée n'en envoie aucune.

Le site a aussi des comptes (Discord ou Google), des amis avec leur présence en jeu, un historique, les signalements avec une page de modération (`/moderation`, pour les comptes listés dans `ADMIN_USER_IDS`), et les pages Conditions et Confidentialité. La mise en ligne est décrite dans [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) ; le site tourne sur https://couchwarp.sachapastor34.workers.dev.

Par défaut, un invité joue à la manette seulement : son clavier n'atteint le jeu que si l'hôte l'autorise dans la console. Ctrl+C ferme la partie pour tout le monde.

Le clavier des invités est mis en pause dès que la fenêtre du jeu n'est plus au premier plan. Pour tester l'hôte et l'invité sur le même Mac, où le navigateur passe forcément devant le jeu, lance l'hôte avec `--ignore-focus` : les touches continuent d'aller au jeu, et à lui seul.

À la première utilisation, macOS demande deux autorisations pour l'application (ou le terminal qui lance l'hôte) :

- **Enregistrement de l'écran** (Réglages Système > Confidentialité et sécurité), pour capturer la fenêtre ;
- **Accessibilité**, pour envoyer les touches des invités au jeu.

Sous Windows, aucune autorisation n'est demandée. Pour que les manettes des invités agissent sur le jeu, installe et lance [VIIPER](https://alia5.github.io/VIIPER/) (il crée les manettes virtuelles : Xbox 360 par défaut, DualShock 4 pour un invité qui choisit « PlayStation » dans son menu) : l'hôte le détecte au démarrage sur `127.0.0.1:3242` et l'annonce aux invités. Sans VIIPER, le clavier fonctionne et les manettes sont reçues sans agir. Pense aussi à lancer l'hôte avec les mêmes droits que le jeu : Windows bloque les touches envoyées à un jeu lancé en administrateur depuis un programme qui ne l'est pas.

Sous Linux, l'hôte partage les fenêtres X11, et sous Wayland celles qui passent par XWayland : c'est le cas de Steam, Proton, Wine et des jeux SDL par défaut. Les touches, souris et manettes des invités passent par `uinput`, qui demande l'accès en écriture à `/dev/uinput`. Le paquet `steam-devices` (ou `steam` sur certaines distributions) le donne déjà à la personne devant l'écran ; sinon, une règle udev suffit :

```sh
echo 'KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"' \
  | sudo tee /etc/udev/rules.d/60-couchwarp-uinput.rules
sudo udevadm control --reload && sudo udevadm trigger
```

Chaque manette d'invité apparaît comme une manette Xbox 360 filaire (sans gyroscope). Le son du jeu, et de tout processus qu'il a lancé, est enregistré seul avec `parec` (paquet `pulseaudio-utils`, sur PulseAudio comme sur PipeWire).

Pour les téléphones d'un même réseau, le client doit être servi en HTTPS (l'API Gamepad l'exige) : le plus simple est de déployer (`pnpm run deploy`) ou de passer par un tunnel.

## Limites connues

- **Manettes sur un hôte Mac** : macOS ne permet pas à une application de créer une manette virtuelle. Les manettes des invités reçoivent une place de joueur mais n'agissent pas sur le jeu. Avec un hôte Windows et VIIPER, ou un hôte Linux, elles agissent.
- **Hôte Windows** : il compile et passe ses tests sur Windows (intégration continue), mais n'a pas encore tourné sur un vrai PC de jeu. Il encode en logiciel (OpenH264) à la taille de la fenêtre : `--max-height` n'y a pas d'effet, et les encodeurs matériels (NVIDIA, AMD, Intel) viendront ensuite.
- **Hôte Linux** : compilé et testé en intégration continue (la capture lit une vraie fenêtre sur un serveur X virtuel), mais pas encore essayé sur un vrai bureau. Les fenêtres natives Wayland ne sont pas listées (il faudrait le portail de partage d'écran) ; la capture lit la fenêtre par X11 sans mémoire partagée, ce qui coûte du processeur en 1080p ; le curseur n'apparaît pas dans l'image ; l'encodage est logiciel (OpenH264), VA-API viendra ensuite.
- **Réseau** : l'hôte écoute sur une seule interface en IPv4. Sans clé TURN Cloudflare (voir `services/edge/.dev.vars.example`), un invité derrière un réseau très fermé ne peut pas se connecter.
- **Son** : sur Mac, celui de l'application qui possède la fenêtre ; un jeu qui joue son son dans un processus à part (jeux dans un navigateur, applications Electron) arrive muet. Sous Windows et Linux, le son du jeu et de tous les processus qu'il a lancés est capturé.
- **Navigateurs basés sur Firefox (Firefox, Zen)** : sur macOS, ils peuvent n'ouvrir aucune connexion WebRTC (autorisation « Réseau local »). L'invité voit alors un message qui le dit ; Chrome, Edge et Arc fonctionnent.
- **Une seule qualité pour tous** : le débit s'adapte au réseau de l'invité le moins bien connecté (pertes et latence qu'il mesure, remontées chaque seconde). `--bitrate` fixe le plafond. Une qualité par invité demandera plusieurs encodages.
- **Souris** : l'hôte l'autorise invité par invité dans la console ; l'invité clique sur l'image pour verrouiller le pointeur. Sous Windows, le curseur reste confiné à la fenêtre du jeu tant qu'une souris invitée agit ; sous Linux, il ne l'est pas encore. Sur Mac, les jeux qui lisent la position du curseur système plutôt que les événements reçus peuvent l'ignorer.
- **Fenêtre fermée** : si le jeu se ferme, l'hôte s'arrête et les invités voient « L'hôte a fermé la partie ». La relance automatique du jeu est prévue au jalon 1.

## Vérifier

```sh
pnpm check                                     # lint, types, tests JavaScript
cargo test                                     # tests Rust
cargo clippy --all-targets -- -D warnings
```

Les règles du dépôt (code, textes, design) sont dans [CONTRIBUTING.md](CONTRIBUTING.md) et [DESIGN.md](DESIGN.md).
