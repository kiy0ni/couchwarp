# Système visuel

Couchwarp doit avoir l'air sobre et sûr, comme un outil, pas comme un jeu. L'identité vient d'un seul objet réel : **les quatre témoins de joueur d'une manette de console**.

Les jetons sont dans [apps/web/src/styles/tokens.css](apps/web/src/styles/tokens.css). Aucune couleur, police ou durée n'est écrite en dur ailleurs.

## Couleur

| Rôle              | Jeton                                   | Usage                                                                          |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| Fond              | `--color-paper`                         | Anthracite chaud, le salon lumière éteinte                                     |
| Surfaces          | `--color-paper-2`, `-3`                 | Barre en jeu, menus, fond des témoins                                          |
| Texte             | `--color-ink`, `-2`, `--color-muted`    | Crème, du plus fort au plus discret                                            |
| Action principale | `--color-accent`                        | Crème sur anthracite : le bouton principal n'a pas de couleur                  |
| Joueurs           | `--color-p1` à `--color-p4`             | Corail, ciel, citron vert, ambre. **Les seules couleurs vives de l'interface** |
| États             | `--color-success`, `-warning`, `-error` | Toujours accompagnés d'un texte                                                |

Règle : une couleur vive à l'écran désigne un joueur. On ne s'en sert ni pour décorer ni pour les boutons.

## Typographie

- **Bricolage Grotesque** pour les titres et le logo : un caractère reconnaissable, sans effet.
- **Rethink Sans** pour le texte et les contrôles.
- **JetBrains Mono** pour le code de partie seulement, où il faut distinguer chaque caractère.

Pas de majuscules forcées, pas de texte espacé, pas de dégradé.

## Le motif des témoins

Quatre pastilles côte à côte. Le joueur 2, c'est la deuxième allumée dans sa couleur, les autres éteintes, comme sur une manette. Il apparaît :

- dans le logo, les quatre allumées ;
- dans la barre en jeu, une rangée par manette de l'invité ;
- au-delà de quatre joueurs, le motif reprend et le numéro s'ajoute à côté.

## Organisation

Couchwarp se range comme une application, pas comme un site :

- à partir de 960 px, une barre latérale (Accueil, Parties, Héberger, Amis, Paramètres, et Modération pour l'équipe), le compte en bas ;
- en dessous, une barre d'onglets en bas de l'écran et une petite barre en haut avec le compte ;
- chaque page a un titre, une phrase, ses actions à droite, puis des cartes (`paper-2`, une bordure fine, 16 px de rayon), jamais une carte dans une carte ;
- l'accueil sert de tableau de bord : rejoindre avec un code, héberger, amis en ligne, manettes branchées, dernières parties, parties publiques ;
- la partie elle-même reste en plein écran, sans barre latérale.

Dans l'application Mac, la page passe sous la barre de titre : la barre latérale garde de la place pour les boutons de la fenêtre et sert à la déplacer.

## Formes et mouvement

- Rayons : 10 px pour les contrôles, 16 px pour les menus.
- Une seule bordure fine par niveau, pas d'ombre portée sauf le voile derrière un menu.
- Mouvements courts (120 à 220 ms), seulement sur `transform` et `opacity`, désactivés si l'appareil demande moins d'animations.

## Interaction

- Tout se pilote à la manette : croix ou stick pour se déplacer, A pour valider, B pour revenir. Sur le code, haut et bas changent la lettre.
- Le focus est toujours visible (anneau bleu ciel).
- Cibles tactiles de 44 px minimum, champs de 48 px.

## Ce qu'on ne fait pas

Ces choix ont été essayés et refusés : thème « arcade » (police pixel, effet RVB, trame d'écran, ombres décalées), jugé trop « kikoo » ; gris-bleu avec bouton bleu dans une carte centrée, jugé générique. Et de façon générale : dégradés violet-bleu, verre dépoli, émojis comme icônes, chiffres ou témoignages inventés.
