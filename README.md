# Couchwarp

Jouer en multijoueur local à distance. L'hôte partage la fenêtre de son jeu, ses amis le rejoignent depuis un navigateur avec un code à six caractères, sans rien installer, et jouent avec leur manette ou leur clavier.

Statut : **jalon 0a terminé, début du jalon 1**. La chaîne complète fonctionne avec un hôte macOS : image et son du jeu, encodage matériel, WebRTC, client web. Les invités jouent au clavier (touches du jeu ou clavier converti en manette), à la manette, ou avec une manette tactile sur téléphone. Le cahier des charges est dans [docs/CAHIER-DES-CHARGES.md](docs/CAHIER-DES-CHARGES.md), le fonctionnement technique dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Mesures du jalon 0a

Hôte et invité sur un MacBook Air M3, fenêtre de 1728 × 1080 à 60 images par seconde, H.264 matériel à 12 Mbit/s :

| Mesure                                       | Valeur                                       |
| -------------------------------------------- | -------------------------------------------- |
| Capture jusqu'à l'envoi réseau (hôte)        | 8,8 ms en médiane                            |
| Capture jusqu'à l'affichage (invité)         | 28 ms en médiane, 40 ms pour 95 % des images |
| Clic sur « Jouer » jusqu'à la première image | 325 ms                                       |

Ces chiffres sont mesurés en local, sans réseau entre les deux. La mesure sur Internet reste à faire (jalon 0b).

## Lancer en local

Prérequis : Node 22 et pnpm (via mise), Rust stable. L'hôte tourne sur macOS 13 ou plus récent, ou sur Windows 10 (version 2004) ou plus récent.

```sh
pnpm install
pnpm dev                 # serveur de salons sur :8787, client web sur :5173
```

Dans un autre terminal :

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

Par défaut, un invité joue à la manette seulement : son clavier n'atteint le jeu que si l'hôte l'autorise dans la console. Ctrl+C ferme la partie pour tout le monde.

Le clavier des invités est mis en pause dès que la fenêtre du jeu n'est plus au premier plan. Pour tester l'hôte et l'invité sur le même Mac, où le navigateur passe forcément devant le jeu, lance l'hôte avec `--ignore-focus` : les touches continuent d'aller au jeu, et à lui seul.

À la première utilisation, macOS demande deux autorisations pour le terminal qui lance l'hôte :

- **Enregistrement de l'écran** (Réglages Système > Confidentialité et sécurité), pour capturer la fenêtre ;
- **Accessibilité**, pour envoyer les touches des invités au jeu.

Sous Windows, aucune autorisation n'est demandée. Pour que les manettes des invités agissent sur le jeu, installe et lance [VIIPER](https://alia5.github.io/VIIPER/) (il crée les manettes Xbox virtuelles) : l'hôte le détecte au démarrage sur `127.0.0.1:3242` et l'annonce aux invités. Sans VIIPER, le clavier fonctionne et les manettes sont reçues sans agir. Pense aussi à lancer l'hôte avec les mêmes droits que le jeu : Windows bloque les touches envoyées à un jeu lancé en administrateur depuis un programme qui ne l'est pas.

Pour les téléphones d'un même réseau, le client doit être servi en HTTPS (l'API Gamepad l'exige) : le plus simple est de déployer (`pnpm deploy`) ou de passer par un tunnel.

## Limites connues

- **Manettes sur un hôte Mac** : macOS ne permet pas à une application de créer une manette virtuelle. Les manettes des invités reçoivent une place de joueur mais n'agissent pas sur le jeu. Avec un hôte Windows et VIIPER, elles agissent.
- **Hôte Windows** : il compile et passe ses tests sur Windows (intégration continue), mais n'a pas encore tourné sur un vrai PC de jeu. Il encode en logiciel (OpenH264) à la taille de la fenêtre : `--max-height` n'y a pas d'effet, et les encodeurs matériels (NVIDIA, AMD, Intel) viendront ensuite.
- **Hôte Linux** : pas encore écrit.
- **Réseau** : l'hôte écoute sur une seule interface en IPv4. Sans clé TURN Cloudflare (voir `services/edge/.dev.vars.example`), un invité derrière un réseau très fermé ne peut pas se connecter.
- **Son** : sur Mac, celui de l'application qui possède la fenêtre ; un jeu qui joue son son dans un processus à part (jeux dans un navigateur, applications Electron) arrive muet. Sous Windows, le son du jeu et de tous les processus qu'il a lancés est capturé.
- **Navigateurs basés sur Firefox (Firefox, Zen)** : sur macOS, ils peuvent n'ouvrir aucune connexion WebRTC (autorisation « Réseau local »). L'invité voit alors un message qui le dit ; Chrome, Edge et Arc fonctionnent.
- **Manette PlayStation** : l'invité peut la choisir, mais l'hôte crée encore des manettes Xbox dans tous les cas.
- **Débit fixe** : la qualité ne s'adapte pas encore au réseau de chaque invité ; règle-la avec `--bitrate` (en Mbit/s).
- **Fenêtre fermée** : si le jeu se ferme, l'hôte s'arrête et les invités voient « L'hôte a fermé la partie ». La relance automatique du jeu est prévue au jalon 1.

## Vérifier

```sh
pnpm check                                     # lint, types, tests JavaScript
cargo test                                     # tests Rust
cargo clippy --all-targets -- -D warnings
```

Les règles du dépôt (code, textes, design) sont dans [CONTRIBUTING.md](CONTRIBUTING.md) et [DESIGN.md](DESIGN.md).
