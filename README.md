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

Prérequis : Node 22 et pnpm (via mise), Rust stable, macOS 13 ou plus récent pour l'hôte.

```sh
pnpm install
pnpm dev                 # serveur de salons sur :8787, client web sur :5173
```

Dans un autre terminal :

```sh
cargo run -p couchwarp-host -- --list-windows
cargo run -p couchwarp-host -- --window "nom du jeu"
```

L'hôte affiche le code de la partie, le lien et un QR code. Ouvre le lien dans Chrome, Edge ou Arc, choisis un pseudo, puis « Jouer ».

Le clavier des invités est mis en pause dès que la fenêtre du jeu n'est plus au premier plan. Pour tester l'hôte et l'invité sur le même Mac, où le navigateur passe forcément devant le jeu, lance l'hôte avec `--ignore-focus` : les touches continuent d'aller au jeu, et à lui seul.

À la première utilisation, macOS demande deux autorisations pour le terminal qui lance l'hôte :

- **Enregistrement de l'écran** (Réglages Système > Confidentialité et sécurité), pour capturer la fenêtre ;
- **Accessibilité**, pour envoyer les touches des invités au jeu.

Pour les téléphones d'un même réseau, le client doit être servi en HTTPS (l'API Gamepad l'exige) : le plus simple est de déployer (`pnpm deploy`) ou de passer par un tunnel.

## Limites connues

- **Manettes sur un hôte Mac** : macOS ne permet pas à une application de créer une manette virtuelle. Les manettes des invités reçoivent une place de joueur mais n'agissent pas sur le jeu. Elles fonctionneront avec l'hôte Windows (jalon 0b, via VIIPER).
- **Hôte Windows et Linux** : pas encore écrits.
- **Réseau** : l'hôte écoute sur une seule interface en IPv4. Sans clé TURN Cloudflare (voir `services/edge/.dev.vars.example`), un invité derrière un réseau très fermé ne peut pas se connecter.
- **Son** : celui de l'application qui possède la fenêtre. Un jeu qui joue son son dans un processus à part (jeux dans un navigateur, applications Electron) arrive muet.
- **Navigateurs basés sur Firefox (Firefox, Zen)** : sur macOS, ils peuvent n'ouvrir aucune connexion WebRTC (autorisation « Réseau local »). L'invité voit alors un message qui le dit ; Chrome, Edge et Arc fonctionnent.
- **Fenêtre fermée** : si le jeu se ferme, l'hôte s'arrête et les invités voient « L'hôte a fermé la partie ». La relance automatique du jeu est prévue au jalon 1.

## Vérifier

```sh
pnpm check                                     # lint, types, tests JavaScript
cargo test                                     # tests Rust
cargo clippy --all-targets -- -D warnings
```

Les règles du dépôt (code, textes, design) sont dans [CONTRIBUTING.md](CONTRIBUTING.md) et [DESIGN.md](DESIGN.md).
