# Contribuer à Couchwarp

Règles du dépôt. Elles s'appliquent au code, aux textes de l'interface, à la documentation et aux messages de commit.

## Organisation

| Dossier             | Contenu                                                        | Langage           |
| ------------------- | -------------------------------------------------------------- | ----------------- |
| `crates/protocol`   | Messages échangés entre l'hôte, le serveur et les invités      | Rust              |
| `crates/host`       | Application hôte : capture, encodage, WebRTC, entrées          | Rust              |
| `packages/protocol` | Le même protocole, côté navigateur et serveur                  | TypeScript        |
| `services/edge`     | Serveur de salons (Cloudflare Workers + Durable Objects)       | TypeScript        |
| `apps/web`          | Client invité (PWA)                                            | TypeScript, React |
| `fixtures/protocol` | Exemples de messages partagés par les tests Rust et TypeScript | JSON              |

Le protocole existe en deux langages. Toute modification passe par `fixtures/protocol` : un message ajouté ou changé y reçoit un exemple, et les deux suites de tests le vérifient.

## Commandes

```sh
pnpm install          # dépendances JavaScript
pnpm dev              # serveur de salons + client web en local
pnpm check            # lint, types et tests JavaScript
cargo test            # tests Rust
cargo clippy --all-targets -- -D warnings
cargo run -p couchwarp-host -- --help
```

## Code

- **Noms et commentaires en anglais**, documentation en français.
- **Pas d'abstraction sans deuxième usage.** Un trait, une interface ou une fabrique n'existe que s'il a au moins deux implémentations réelles (par exemple une par système d'exploitation).
- **Pas de code mort**, pas de fonction « pour plus tard », pas de paramètre inutilisé.
- **Les erreurs remontent.** Pas de `catch` ou de `unwrap_or_default` qui avale une erreur. Une erreur ignorée volontairement porte un commentaire qui dit pourquoi.
- **Pas de garde pour un cas impossible.** On valide aux frontières (réseau, saisie utilisateur, API système), puis on fait confiance aux types.
- **Commentaires rares.** Un commentaire explique _pourquoi_, jamais _quoi_. Une ligne qui répète le code est supprimée.
- **Noms du domaine** : `guest`, `slot`, `room`, `pad`, `frame`. Jamais `data`, `info`, `manager`, `handler` seuls.
- **Fonctions courtes**, un seul niveau d'abstraction par fonction.
- Rust : `cargo fmt`, `clippy` sans avertissement, `unsafe` limité aux appels système, chaque bloc `unsafe` précédé d'un commentaire `// SAFETY:`.
- TypeScript : mode `strict`, Biome pour le format et le lint, pas de `any`.

## Tests

- Un test doit pouvoir échouer. Il vérifie un comportement attendu, écrit à partir de la spécification, pas recopié de l'implémentation.
- Les cas limites d'abord : paquet tronqué, numéro de séquence qui reboucle, salon plein, touche interdite.

## Textes (interface et documentation)

Écrire comme on parle à un ami qui va jouer, en phrases courtes. Les règles suivantes viennent de la page Wikipedia [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) et des guides de rédaction d'interface.

- **Pas de tiret cadratin ni demi-cadratin** (— et –). Une virgule, deux-points, un point ou des parenthèses à la place.
- **Pas de mots creux** : « fluide », « robuste », « puissant », « intuitif », « sans effort », « révolutionnaire », « seamless », « robust », « leverage », « delve », « elevate ».
- **Pas de figures de style toutes faites** : « Ce n'est pas X, c'est Y », « Que vous soyez X ou Y », listes de trois adjectifs, phrase d'accroche avant le sujet.
- **Pas d'émoji comme icône**, pas de point d'exclamation dans les messages d'erreur, pas de « Oups ».
- **Boutons** : le verbe de l'action (« Rejoindre », « Jouer »), jamais « Valider » ou « Cliquez ici ».
- **Erreurs** : ce qui s'est passé, puis quoi faire. « Ce code ne correspond à aucune partie. Vérifie-le avec l'hôte. »
- **Chiffres** : seulement ceux qu'on a mesurés. Jamais de statistique, de témoignage ou de logo inventé.
- Guillemets français « » en français, apostrophe typographique ’, points de suspension … en un caractère, espace insécable avant les unités (`20 ms`).

## Design

Le système visuel est décrit dans [DESIGN.md](DESIGN.md). Toute couleur, police, taille ou durée passe par un jeton déclaré dans `apps/web/src/styles/tokens.css`.

## Commits

Format [Conventional Commits](https://www.conventionalcommits.org/) à l'impératif, en anglais : `feat(host): capture a single window on macOS`. Un commit = un changement cohérent qui compile et passe les tests.
