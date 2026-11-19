# Couchwarp : cahier des charges

> Arcade de jeu à distance : l'hôte lance son jeu, les invités jouent depuis le navigateur.
> Version 0.1, 19/11/2026. Statut : conception, rien n'est codé.
> Nom : couchwarp.com, .gg, .app et .io sans aucun enregistrement DNS au 19/11/2026 (indice, pas une garantie). À réserver vite, au moins .com et .gg.

---

## 1. La promesse en une phrase

**« Tu lances ton jeu, tu envoies un lien, tes potes jouent avec toi comme s'ils étaient sur ton canapé, depuis n'importe quel appareil, sans rien installer. »**

Trois règles qui guident toutes les décisions :

1. **Invité : 0 installation, 0 compte, 1 clic.** Ouvrir le lien → pseudo → manette détectée → on joue. Moins de 15 secondes.
2. **Hôte : 3 clics.** Choisir le jeu → choisir privé / public → partager. Le reste (qualité, réseau, manettes) est automatique, avec des réglages avancés cachés.
3. **La latence passe avant tout le reste.** Si une fonctionnalité ajoute de la latence, elle est facultative ou elle n'existe pas.

---

## 2. État de l'art (recherche du 19/11/2026)

| Produit                                 | Ce qu'il fait bien                                                                                                                                                                                                                              | Ses limites (= notre place)                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Parsec Arcade** (fermé le 17/04/2023) | Annuaire de salons publics, capture **de la fenêtre du jeu seule** (pas d'écho, pas de bureau visible), permissions par invité (manette / clavier / souris).                                                                                    | Invités obligés d'installer Parsec. Passage de manette, gestion des invités, chat et overlay restés « prévus ». Fermé sans successeur officiel.                                                                                                                                                                                                                                            |
| **Parsec** (aujourd'hui)                | Très bonne latence, permissions par connexion, « Approved Apps » (entrées limitées à certaines applis).                                                                                                                                         | Installation obligatoire, pas d'annuaire, orienté pro.                                                                                                                                                                                                                                                                                                                                     |
| **Steam Remote Play Together**          | Lien d'invitation, l'invité n'a pas besoin du jeu.                                                                                                                                                                                              | Jeux compatibles seulement. **Un seul** invité sans Steam par lien, et il doit installer Steam Link. Pas de salons publics.                                                                                                                                                                                                                                                                |
| **moonlight-web** (linckosz, GPL-3.0)   | Navigateur sans installation, < 20 ms en LAN, H.264/HEVC/AV1, manette tactile, partage de session (3 invités, lien + PIN, rôles).                                                                                                               | Pensé pour streamer _son propre_ PC. Pas d'annuaire, pas de social, 3 invités max, ouverture de ports UPnP. **Meilleure référence technique** et banc d'essai.                                                                                                                                                                                                                             |
| **Sunshine / Apollo / Vibeshine**       | Hôtes open source matures, écran virtuel par client (Apollo/SudoVDA, Windows).                                                                                                                                                                  | Un seul utilisateur à la fois, client Moonlight à installer.                                                                                                                                                                                                                                                                                                                               |
| **Wolf** (Games on Whales)              | Plusieurs sessions isolées sur un GPU.                                                                                                                                                                                                          | Sessions _séparées_ : l'inverse du multijoueur local partagé.                                                                                                                                                                                                                                                                                                                              |
| **Smash Soda + Soda Arcade**            | Le plus proche de notre idée. Annuaire de salons (Soda Arcade) + outil d'hôte (Smash Soda) : ping max auto-kick, modérateurs, échange de manettes, clavier → manette, « Kiosk » (relance le jeu), « Hotseat » (temps de jeu par invité, prévu). | Invités obligés d'installer Parsec. L'hôte doit **compiler l'outil lui-même** (binaires non distribuables) et dépend de Parsec, qui a déjà cassé Parsec Soda en août 2025. Clavier → manette réglé **touche par touche via la commande de chat `!kb`**. Le Kiosk relance le jeu mais n'empêche pas d'en sortir. Interface d'outil technique en widgets. Voir 3.4 pour ce qu'on fait mieux. |
| **Axiom, Reemo, Shadow**                | Client navigateur.                                                                                                                                                                                                                              | Bureau à distance ou cloud PC : pas de social, pas de multijoueur local.                                                                                                                                                                                                                                                                                                                   |

**Conclusion :** personne ne combine aujourd'hui _navigateur sans installation_ + _plusieurs manettes vers un seul jeu_ + _annuaire de salons_ + _social_. C'est exactement le trou laissé par Parsec Arcade.

Ce que la recherche apprend aussi :

- **Ce que les hôtes réclamaient** (Smash Soda, Parsec Soda) : limite de ping avec expulsion auto, échange de manettes, bannissement (même de quelqu'un parti), modérateurs, commandes de chat, journal.
- **Ce qui manquait à Arcade** : passage de manette, gestion des invités, chat correct, overlay en jeu.

---

## 3. Fonctionnalités

Légende : **MVP** = première version utilisable entre amis · **V1** = lancement public · **V2** = ensuite · 💡 = nouveauté qu'aucun concurrent n'a.

### 3.1 Côté hôte (application de bureau)

**Démarrer une partie**

- **MVP** Installation en un fichier (Windows d'abord), mise à jour automatique silencieuse.
- **MVP** Choix du jeu : liste des fenêtres ouvertes + **détection des bibliothèques** (Steam, Epic, GOG, Xbox/Game Pass, Battle.net, EA, Ubisoft, Playnite, émulateurs). **V1** jaquettes et nombre de joueurs locaux max récupérés automatiquement.
- **MVP** Capture **de la fenêtre du jeu seule** (comme Arcade) ; capture de l'écran entier en option.
- **MVP** Son **du jeu seul** (capture audio par processus) : pas de Discord, pas de notifications, pas d'écho.
- **MVP** Privé (lien / code / QR) ou public (annuaire).
- 💡 **V1** **Profils de jeu** : se souviennent des slots, permissions, qualité et disposition tactile par jeu. Profils communautaires pour les jeux connus.

**Gérer les joueurs**

- **MVP** **Slots de manette 1 à 8**, assignation par glisser-déposer (« Léa → manette 2 »).
- **MVP** Permissions par invité : _spectateur_, _manette_, _clavier_, _souris_, combinables. Par défaut : manette seule.
- **MVP** Expulser, bannir (y compris quelqu'un déjà parti), rendre muet.
- **MVP** **Passer la manette** : un invité prend le slot d'un autre en un geste (jeux tour par tour, mode « chacun son tour »).
- **V1** Salle d'attente : l'hôte valide chaque entrée (ou validation auto).
- **V1** **Limite de ping** avec avertissement puis retrait automatique du slot (sans expulsion du salon).
- **V1** Modérateurs nommés par l'hôte.
- 💡 **V1** **Rotation automatique** « le gagnant reste » / « à tour de rôle » : file d'attente de spectateurs qui prennent la manette à la fin de chaque manche (bouton ou détection).
- 💡 **V1** « Lever la main » : un spectateur demande une manette, l'hôte accepte en un clic.

**Confidentialité et sécurité de l'hôte** (le détail de l'isolation des entrées est en 3.3)

- 💡 **MVP** **Écran de pause automatique** : si le jeu perd le premier plan (alt-tab, notification, UAC), l'image envoyée se fige et se floute.
- 💡 **MVP** **Pare-feu clavier** et **verrou de focus** : voir 3.3.
- **MVP** **Garde-jeu** : si le jeu se ferme ou plante, il est relancé automatiquement (comme le Kiosk de Soda) **et** les invités ne voient jamais le bureau pendant ce temps (image « Le jeu redémarre… »).
- **V1** Bouton panique (raccourci global) : coupe tout et met en pause.
- **V1** Masquer pseudos et chat dans l'image streamée.

**Pendant la partie**

- **MVP** Overlay en jeu (raccourci) : joueurs, slots, ping, chat, qualité.
- **MVP** Qualité automatique, réglages avancés repliés (résolution, i/s, débit, codec).
- **MVP** Télécommande de l'hôte depuis son téléphone : gérer le salon sans quitter le jeu.
- **V1** **Écran virtuel** à la bonne résolution (pas besoin d'écran branché, pas de 4K inutile si tout le monde est en 1080p).
- **V1** Chat vocal intégré (facultatif, l'audio du jeu reste séparé).
- 💡 **V2** **Clips** : « garder les 30 dernières secondes » en un bouton (mémoire tampon côté hôte), partageables.
- **V2** HDR, 120/144 i/s.
- **V2** Réveil à distance : allumer le PC hôte depuis le téléphone (Wake-on-LAN par l'appli).

### 3.2 Côté invité (navigateur, sans installation)

**Rejoindre**

- **MVP** Lien, code à 6 caractères ou QR. Aperçu riche quand le lien est collé (Discord, WhatsApp…).
- **MVP** Pseudo + avatar en 1 écran, **sans compte**.
- 💡 **MVP** **Vérification en 3 secondes** avant d'entrer : navigateur compatible, codec matériel, réseau (ping, débit), manette détectée. Message clair si un problème (« Ton Wi-Fi est saturé, rapproche-toi de la box »).
- **V1** Salle d'attente avec aperçu live de la partie.

**Contrôles**

- **MVP** Manettes physiques USB / Bluetooth (Gamepad API) : Xbox, PlayStation, Switch Pro, 8BitDo… avec écran de test.
- **MVP** **Plusieurs manettes sur un même invité** : deux personnes chez Léa = deux slots.
- **MVP** **Manette tactile** à l'écran pour les téléphones sans manette, avec dispositions prêtes (moderne, rétro 2 boutons, combat, course) et **éditeur** (déplacer, redimensionner, opacité).
- **MVP** Vibrations (quand le navigateur les gère ; vibreur du téléphone sur Android).
- **MVP** Clavier et souris de l'ordinateur, avec plusieurs modes (voir 3.3).
- **V1** Remappage des boutons par invité, mode une main, zones mortes.
- 💡 **V1** **Téléphone = manette, télé = écran** : l'invité ouvre le salon sur sa TV ou son PC, scanne le QR avec son téléphone, qui devient sa manette tactile (le téléphone n'affiche pas la vidéo → pas de lag de décodage).
- 💡 **V2** Gyroscope du téléphone (visée, volant), volants et joysticks de vol.

**Confort**

- **MVP** Plein écran, rotation paysage forcée, empêcher la mise en veille.
- **MVP** Indicateur de latence honnête (ping + latence image), couleur vert / orange / rouge.
- **MVP** **PWA installable** (sur iPhone, c'est la seule façon d'avoir le vrai plein écran).
- **V1** Chat texte, réactions emoji par-dessus la vidéo (désactivables).
- **V1** Changer de qualité à la volée, mode « économie de données ».
- 💡 **V1** **Bouton « Pourquoi ça lag ? »** : diagnostic qui dit qui est en cause (ton réseau, celui de l'hôte, la distance, le décodage de ton appareil) et quoi faire.
- **V2** Amélioration d'image dans le navigateur (upscaling GPU) pour les petits débits.

### 3.3 Plusieurs claviers et souris, et isolation totale

Trois garanties :

1. **Chaque invité a son propre périphérique**, distinct de ceux des autres et de celui de l'hôte.
2. **Rien de ce qu'un invité tape ou clique ne peut sortir du jeu.**
3. **L'hôte garde toujours la priorité** sur son PC.

**Modes d'entrée, par invité** (choisis automatiquement selon le profil du jeu, modifiables par l'hôte en un clic)

| Mode                             | Fonctionnement                                                                                                                                                                                                                    | Pour quels jeux                                                                                                                  | Jalon |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Clavier → manette**            | Les touches de l'invité pilotent **sa** manette virtuelle. Disposition par défaut + **éditeur visuel** (cliquer sur le bouton, appuyer sur la touche).                                                                            | Tous les jeux jouables à la manette, donc la grande majorité du multijoueur local. **Mode par défaut** d'un invité sans manette. | MVP   |
| 💡 **Clavier partagé par zones** | Chaque invité tape avec **ses** touches habituelles (ZQSD/WASD) ; elles sont traduites vers la zone qui lui est attribuée sur le clavier du jeu (J1 = WASD, J2 = flèches, J3 = IJKL…). Personne ne doit apprendre une autre zone. | Jeux « 2 joueurs sur un clavier » (fréquent chez les indés).                                                                     | V1    |
| **Clavier distinct**             | Chaque invité devient un **clavier USB virtuel séparé** (VIIPER sait créer des claviers et souris HID distincts). Un jeu qui lit les claviers en Raw Input les voit comme des claviers différents.                                | Jeux qui gèrent plusieurs claviers nativement (rares, signalés dans le profil du jeu).                                           | V1    |
| **Jeton clavier + souris**       | Un seul invité à la fois tient le clavier/souris « principal » ; le jeton se passe en un clic (ou glisser-déposer).                                                                                                               | Jeux à la souris : stratégie, point & click, jeux de société.                                                                    | MVP   |
| **Multi-souris**                 | Crochets injectés dans le jeu, façon ProtoInput / Nucleus Co-op (plusieurs curseurs, faux focus).                                                                                                                                 | Jeux compatibles, liste communautaire ; désactivé pour les jeux avec anti-triche.                                                | V2    |

Limite à connaître : Windows n'a **qu'un seul curseur**. Plusieurs souris virtuelles déplacent le même curseur, sauf dans les jeux qui lisent la souris en Raw Input. D'où le jeton par défaut, et le multi-souris réservé au V2.

Détails qui comptent :

- **Codes de touches physiques** (position de la touche, pas le caractère) : un invité en AZERTY et un hôte en QWERTY jouent avec les mêmes touches sous les doigts.
- **Plusieurs claviers chez un même invité** (deux claviers USB branchés chez Léa) : le navigateur ne sait pas les distinguer. Ce cas passe par l'appli invité facultative (V2) ; dans le navigateur, on propose « clavier + manette » ou « clavier partagé par zones ».
- Écrire dans le chat ne va jamais au jeu : le champ de chat capture ses touches.

**Isolation : rien ne sort du jeu**

1. **Une seule porte d'entrée.** Toutes les entrées des invités passent par le filtre de l'appli hôte avant d'être injectées. Ce qui est interdit n'est **jamais** injecté (on ne bloque pas après coup, on n'envoie pas).
2. **Liste noire système, active par défaut** : touche Windows et toutes ses combinaisons, Alt+Tab, Alt+Échap, Alt+F4, Alt+Espace, Ctrl+Échap, Ctrl+Maj+Échap, Impr. écran. Ctrl+Alt+Suppr ne peut de toute façon pas être injecté. Le **bouton Guide / Xbox / PS** des manettes est bloqué aussi (il ouvre la Game Bar ou Steam). Un profil de jeu peut passer en **liste blanche** : seules les touches utiles au jeu passent.
3. **Verrou de focus.** Le clavier et la souris des invités ne sont injectés **que si la fenêtre du jeu est au premier plan**, vérifié à chaque événement. Sinon : toutes les touches tenues sont relâchées (aucune touche bloquée), les entrées sont mises en attente et l'image est floutée. Même chose si le jeu ouvre une autre fenêtre (navigateur, launcher, boîte de dialogue).
4. **Souris en cage.** Les coordonnées des invités sont bornées au rectangle du jeu, et le curseur y est confiné tant qu'un invité tient le jeton. Impossible d'atteindre la barre des tâches ou un autre écran.
5. **Priorité à l'hôte.** Dès que l'hôte touche son propre clavier ou sa souris, la souris des invités est suspendue (1 s par défaut, réglable) ; les manettes continuent. Les raccourcis de l'hôte (overlay, panique) marchent toujours, et les invités ne peuvent pas les déclencher.
6. **L'hôte peut faire autre chose.** S'il passe sur Discord, les claviers invités sont mis en attente : rien ne s'écrit dans Discord. Les manettes continuent pour les jeux qui le permettent. **V2** : « faux focus » (le jeu croit garder le focus, comme ProtoInput) pour que l'hôte utilise vraiment son PC pendant que les invités jouent, et étude d'un mode bac à sable (jeu sur un écran virtuel isolé).

### 3.4 Faire mieux que Soda Arcade

|                             | Soda Arcade + Smash Soda                                             | Nous                                                                          |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Invités                     | Installer Parsec + compte Parsec                                     | Un lien, le navigateur, aucun compte                                          |
| Installation de l'hôte      | Compiler depuis les sources ; dépend de Parsec (déjà cassé une fois) | Installateur signé, mises à jour auto, moteur à nous                          |
| Clavier → manette           | Commande de chat `!kb`, une touche à la fois                         | Éditeur visuel, dispositions prêtes, profils par jeu partagés                 |
| Plusieurs claviers / souris | Non documenté                                                        | 5 modes (3.3), dont clavier partagé par zones                                 |
| Empêcher de sortir du jeu   | Kiosk : relance le jeu s'il est fermé                                | Filtre + verrou de focus + souris en cage **et** relance                      |
| Chacun son tour             | Hotseat : temps de jeu par invité (prévu)                            | File d'attente, rotation par manche ou par temps, « lever la main »           |
| Gestion                     | Commandes de chat (`!restart`…)                                      | Interface graphique + télécommande sur téléphone ; commandes de chat en bonus |
| Interface                   | Outil technique en widgets                                           | Produit grand public, pensé d'abord pour être beau et évident (voir 3.5)      |

### 3.5 Direction visuelle

Le système complet est dans [DESIGN.md](../DESIGN.md). En bref :

- **Sobre, comme un outil** : anthracite chaud, texte crème, bouton principal crème. Pas d'effet « jeu vidéo ».
- **L'identité, ce sont les joueurs** : quatre couleurs (corail, ciel, citron vert, ambre), seules couleurs vives de l'interface, et le motif des **quatre témoins de manette** dans le logo, les badges et la barre en jeu. Le numéro accompagne toujours la couleur (daltonisme).
- **Tout se pilote à la manette**, côté hôte comme côté invité : utilisable depuis le canapé, sur une télé, sans souris.
- **Un écran = une décision** : rejoindre, c'est code, puis pseudo, puis jouer. Les réglages avancés existent mais restent repliés.
- Animations courtes, textes lisibles à 3 mètres sur une télé.

### 3.6 Salons et annuaire public

- **MVP** Salon privé : lien, code, QR, mot de passe facultatif, lien à durée limitée / usage unique, révocable.
- **V1** Salon public dans l'**annuaire** avec :
  - 💡 **vignette live** de la partie (image basse qualité rafraîchie), pas juste une jaquette ;
  - jeu, places libres / total, nombre de spectateurs, langue, région, **ping estimé depuis chez toi** ;
  - filtres : jeu, genre, places libres, ping max, langue, ambiance (« chill », « compétitif », « débutants bienvenus »), contenu 18+ masqué par défaut ;
  - tri par ping, par places libres, par popularité.
- **V1** Visibilité « amis seulement », « amis d'amis », « serveur Discord ».
- **V1** Règles du salon affichées à l'entrée.
- 💡 **V1** **File d'attente** « prévenez-moi quand une place se libère » (notification).
- 💡 **V2** **Parties programmées** : créer un événement (« Smash vendredi 21 h »), lien d'inscription, rappel.
- 💡 **V2** **Tournois légers** : arbre automatique, rotation des manettes intégrée.
- **V2** Spectateurs en grand nombre (relai serveur, voir 4.4), mode « commentateur ».

### 3.7 Social et « ultra connectable »

- **MVP** Partage en un clic : copier le lien, QR, partage natif du téléphone.
- **V1** Comptes **facultatifs** : passkey, Discord, Google, Steam. Un compte sert à : amis, historique, réputation, salons publics en tant qu'hôte.
- **V1** Amis, présence (« Léa joue à Overcooked 2, 2 places libres »), invitations directes.
- **V1** **Bot Discord** : `/couchwarp` poste une carte « Rejoindre » dans le salon avec la vignette live et les places libres. (Les Activités Discord ne gèrent pas WebRTC aujourd'hui, donc on passe par un lien, pas par une activité intégrée.)
- **V1** Notifications push (PWA) : invitation, place libre, ami qui ouvre un salon.
- **V2** Statut sur Discord (Rich Presence) et Steam depuis l'appli hôte.
- **V2** Profil public : jeux hébergés, note d'hôte.

### 3.8 Modération (obligatoire dès les salons publics)

- **V1** Signalement d'un joueur ou d'un salon, en un clic, avec capture du chat.
- **V1** Filtre de chat (insultes, liens), mode lent, chat réservé aux comptes.
- **V1** Réputation hôte / invité (bannissements reçus, signalements confirmés).
- **V1** Bannissement de la plateforme ; âge minimum 13 ans (RGPD) ; salons 18+ réservés aux comptes majeurs déclarés.
- **V1** Règles publiques + procédure de signalement (le DSA européen impose un mécanisme de notification et d'action aux hébergeurs).
- **V1** Interdits affichés : jeux piratés / ROMs en salon public, contenu illégal.

### 3.9 Nouveautés : récapitulatif de ce que personne d'autre ne fait

1. Invités 100 % navigateur, téléphone compris, **avec plusieurs manettes par invité**.
2. Téléphone-manette + télé-écran, appairés par QR.
3. Annuaire avec **vignettes live** et **ping estimé** avant d'entrer.
4. Vérification en 3 s + bouton « Pourquoi ça lag ? ».
5. Isolation totale (filtre, verrou de focus, souris en cage, priorité à l'hôte) : l'hôte ne risque rien.
6. Plusieurs claviers et souris distincts, dont le **clavier partagé par zones** (chacun joue avec ses touches habituelles).
7. Rotation automatique des manettes, file d'attente, tournois légers.
8. Profils de jeu partagés par la communauté (slots, tactile, touches interdites).
9. Clips des 30 dernières secondes.
10. Parties programmées avec rappels.
11. Bot Discord avec carte live.

---

### 3.10 Idées reçues le 19/11/2026 : évaluation

Chaque idée est classée : déjà prévue, ajoutée, ou écartée, avec la raison.

| Idée                                                                              | Pertinence                                                                       | Décision                                                                                                                                                        |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Créer une partie en 3 clics (jeu, places, privée par lien)                        | Forte : c'est la promesse                                                        | Déjà prévue (3.1), parcours précisé                                                                                                                             |
| Invité : lien, pseudo, « appuie sur un bouton de ta manette », jouer              | Forte : rend la manette évidente dès l'entrée                                    | **Ajoutée** : étape « appuie sur un bouton » dans l'accueil invité                                                                                              |
| Vidéo, son, manettes, 2 à 4 joueurs                                               | Forte                                                                            | Fait (jusqu'à 8)                                                                                                                                                |
| Manette seule par défaut                                                          | Forte : sécurité de l'hôte                                                       | Déjà prévue (3.1, 3.3) ; à appliquer côté hôte                                                                                                                  |
| « Expulser » et « Fermer la partie »                                              | Forte                                                                            | Déjà prévue (3.1)                                                                                                                                               |
| Overlay latence et connexion                                                      | Forte                                                                            | Partiel ; code couleur ajouté                                                                                                                                   |
| Comptes Discord, historique, amis                                                 | Forte                                                                            | Déjà prévue (3.7) ; **Discord en premier**, Google ensuite                                                                                                      |
| Liste publique filtrable (jeu, région, places libres)                             | Forte                                                                            | Déjà prévue (3.6)                                                                                                                                               |
| Chat et vocal, ou lien vers un salon Discord                                      | Moyenne : le vocal intégré coûte cher, Discord le fait déjà                      | Chat **ajouté au MVP** ; vocal remplacé par un **lien vers un salon Discord**                                                                                   |
| Réassigner les manettes, choisir manette Xbox ou DualShock virtuelle              | Forte : certains jeux n'affichent que les icônes PlayStation                     | **Ajoutée** (VIIPER sait créer les deux)                                                                                                                        |
| Rôles hôte, modérateur, joueur, spectateur ; bans ; mode spectateur               | Forte                                                                            | Déjà prévue (3.1, 3.6)                                                                                                                                          |
| Manette tactile, remappage                                                        | Forte                                                                            | Déjà prévue                                                                                                                                                     |
| Qualité adaptative, choix de résolution et débit                                  | Forte                                                                            | Déjà prévue                                                                                                                                                     |
| Mode « hotseat » : rotation, file d'attente                                       | Forte, attendue des hôtes Smash Soda                                             | Déjà prévue (3.1 rotation)                                                                                                                                      |
| Communautés par jeu, pages de jeux avec jaquettes (IGDB, SteamGridDB)             | Moyenne, utile pour l'annuaire                                                   | **Ajoutée** (V1), dépend d'une clé d'API                                                                                                                        |
| Aperçu vidéo basse fréquence dans la liste                                        | Forte                                                                            | Déjà prévue (vignettes en direct)                                                                                                                               |
| Détection des jeux installés                                                      | Forte                                                                            | Déjà prévue (3.1)                                                                                                                                               |
| Restriction « application approuvée »                                             | Forte                                                                            | Fait par le verrou de focus et l'envoi au seul processus du jeu                                                                                                 |
| Événements planifiés, tournois, bracket                                           | Moyenne                                                                          | Déjà prévue (V2)                                                                                                                                                |
| Extraits de 30 s                                                                  | Moyenne                                                                          | Déjà prévue (V2)                                                                                                                                                |
| Réputation des hôtes                                                              | Moyenne, utile pour le public                                                    | Déjà prévue (3.8)                                                                                                                                               |
| Mode confidentialité : tout par le relais, l'hôte ne voit pas l'IP des invités    | Forte : en direct, l'hôte voit l'adresse IP de chaque invité                     | **Ajoutée** : option « relais seulement », par défaut en partie publique                                                                                        |
| Overlay, mode kiosque, effets sonores, vérification des utilisateurs (Smash Soda) | Overlay et kiosque forts ; effets sonores faibles ; vérification forte en public | Overlay et kiosque prévus ; vérification par compte en public ; effets sonores écartés (gadget)                                                                 |
| Hôtes « cloud » (GPU loué à l'heure)                                              | Moyenne, un autre produit                                                        | **Écartée du MVP** : l'hôte Linux (V1) le rendra possible sur un serveur loué                                                                                   |
| Application mobile                                                                | Faible pour l'invité (la PWA suffit), moyenne pour la visibilité                 | Déjà prévue (V2, applis des stores)                                                                                                                             |
| Navigation façon streaming : jaquette, pastille de ping, places en avatars        | Forte                                                                            | **Ajoutée** à l'annuaire                                                                                                                                        |
| Parcours hôte : installer une fois, « Lancer une partie », jeux détectés          | Forte                                                                            | Déjà prévue                                                                                                                                                     |
| Sentiment de console : plein écran, manette d'abord, rien de technique visible    | Forte                                                                            | Déjà prévue (3.5)                                                                                                                                               |
| Presse-papiers désactivé                                                          | Sans objet : Couchwarp ne partage pas le presse-papiers                          | Rien à faire                                                                                                                                                    |
| Fenêtres administrateur                                                           | Forte sous Windows : une invite de droits ne doit pas être pilotable             | Couvert : Windows bloque l'envoi de touches vers une fenêtre administrateur (UIPI) et le verrou de focus coupe le clavier dès qu'une autre fenêtre passe devant |
| Bouton d'arrêt d'urgence                                                          | Forte                                                                            | Déjà prévue (bouton panique)                                                                                                                                    |
| Public : signalement, modération, âge minimum, journaux, DSA                      | Obligatoire                                                                      | Déjà prévue (3.8) ; **journal des actions de modération ajouté**                                                                                                |
| Lancer en privé d'abord, public ensuite                                           | Forte, prudence juridique                                                        | **Retenue** : l'annuaire public reste désactivé par défaut jusqu'à ce que la modération soit en place                                                           |
| Conditions d'utilisation : l'hôte possède le jeu ; liste de jeux interdits        | Forte                                                                            | **Ajoutée** : conditions d'utilisation et liste de jeux refusés en public                                                                                       |
| RGPD : minimiser, supprimer le compte sur demande                                 | Obligatoire                                                                      | **Ajoutée** : suppression et export du compte en un clic                                                                                                        |

## 4. Architecture technique

### 4.1 Vue d'ensemble

```
┌──────────────────────── PC de l'hôte ────────────────────────┐
│  Appli Couchwarp (Tauri 2 : interface web + cœur Rust)          │
│                                                              │
│  capture fenêtre ─► encodeur matériel ─► WebRTC ─┐           │
│  capture son jeu ─► Opus ───────────────────────┤           │
│  manettes virtuelles ◄── entrées (DataChannel) ◄─┤           │
└──────────────────────────────────────────────────┼───────────┘
                    pair à pair (direct)            │ sinon relai TURN
                         ▼                          ▼
   ┌───────────────── Navigateurs des invités ─────────────────┐
   │ PWA : vidéo, son, Gamepad API, manette tactile, chat      │
   └───────────────────────────────────────────────────────────┘
                         ▲  signalisation, annuaire, comptes
   ┌──────────── Cloudflare (Workers + Durable Objects) ───────┐
   │ 1 Durable Object par salon · D1 (comptes, annuaire) ·     │
   │ TURN Cloudflare Realtime · SFU pour les spectateurs (V2)  │
   └───────────────────────────────────────────────────────────┘
```

### 4.2 Appli hôte : Rust + Tauri 2

Pourquoi un moteur maison plutôt qu'un fork de Sunshine : Sunshine/Apollo sont pensés pour **un** client et leur état global rend le multi-utilisateur très dur (c'est la raison même de l'existence de Wolf). Nous avons besoin dès le départ de N invités, de slots, de permissions et d'un salon. On garde Sunshine et moonlight-web comme **références** et bancs d'essai, pas comme base (ils sont aussi en GPL-3.0).

| Brique                                | Windows (MVP)                                                                                                                                                                                                                                                                                                 | Linux (V1)                                                                                           | macOS (V2)                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Capture image                         | Windows Graphics Capture (par fenêtre), repli DXGI Desktop Duplication                                                                                                                                                                                                                                        | PipeWire via xdg-desktop-portal ; KMS en repli                                                       | ScreenCaptureKit (par fenêtre)                                                                                                                               |
| Capture son                           | Process loopback WASAPI (son d'un seul processus)                                                                                                                                                                                                                                                             | PipeWire (flux de l'application)                                                                     | ScreenCaptureKit audio                                                                                                                                       |
| Encodage                              | NVENC, AMF, Quick Sync ; repli logiciel x264                                                                                                                                                                                                                                                                  | NVENC, VA-API                                                                                        | VideoToolbox                                                                                                                                                 |
| Manettes, claviers et souris virtuels | **Abstraction avec plusieurs pilotes** : VIIPER (USB/IP, pilote signé usbip-win2, en espace utilisateur ; déjà adopté par DS4Windows 5 ; émule Xbox 360, DualShock 4, DualSense, Switch 2 Pro, **claviers et souris HID**, < 1 ms), ViGEmBus en repli pour les manettes, libvirtualhid (LizardByte) à évaluer | `uinput` : un périphérique séparé par invité (règle udev installée par le paquet)                    | **Risque** : les périphériques virtuels demandent un droit (entitlement) qu'Apple accorde mal. Repli : clavier/souris via CGEvent (permission Accessibilité) |
| Isolation des entrées (3.3)           | Filtre avant injection, contrôle du premier plan à chaque événement, cage de la souris, détection des entrées physiques de l'hôte en Raw Input. V2 : crochets façon ProtoInput (faux focus, multi-souris)                                                                                                     | Même filtre ; le premier plan dépend du compositeur, gamescope simplifie (le jeu a son propre écran) | Même filtre via CGEvent                                                                                                                                      |
| Clavier / souris                      | SendInput, filtré par le pare-feu clavier                                                                                                                                                                                                                                                                     | uinput / portail Remote Desktop                                                                      | CGEvent                                                                                                                                                      |
| Écran virtuel                         | SudoVDA (comme Apollo)                                                                                                                                                                                                                                                                                        | gamescope / compositeur imbriqué                                                                     | non                                                                                                                                                          |

- **WebRTC côté hôte : `str0m`** (Rust, MIT, conception « sans I/O ») : on maîtrise l'horloge, le rythme d'envoi et l'injection directe des images encodées, sans la lourdeur de libwebrtc.
- **Un seul encodage pour tous** : tous les joueurs voient la même image, donc on encode une fois et on envoie N copies. **V1** : 2 à 3 couches de qualité (simulcast : 1080p60, 720p60, 480p30) et chaque invité reçoit celle que son réseau supporte.
- **Réglages basse latence** : rafraîchissement intra progressif (pas d'images clés lourdes), pas d'images B, débit plafonné par image, retransmission NACK + correction d'erreurs FEC, contrôle de congestion par invité.

### 4.3 Client invité : PWA

- **Interface** : React + Vite + TypeScript (même pile que tes autres projets, servie par Cloudflare).
- **Vidéo, mode standard** : piste vidéo WebRTC, décodage matériel partout, tampon de gigue réduit au minimum (`jitterBufferTarget` / `playoutDelayHint` à 0).
- **Vidéo, mode turbo (V1, Chromium d'abord)** : images encodées reçues par DataChannel ou WebTransport, décodées par WebCodecs, affichées sur canvas. C'est le chemin de moonlight-web pour descendre sous 20 ms. Sélection automatique selon l'appareil.
- **Codecs** : H.264 par défaut (décodage matériel universel). HEVC et AV1 négociés quand l'hôte ET l'invité les décodent en matériel (vérifié par `MediaCapabilities`).
- **Entrées** : DataChannel **non fiable et non ordonné** qui envoie **l'état complet** de la manette à chaque changement + 60 fois/s (un paquet perdu est remplacé par le suivant, aucune touche ne reste bloquée). Canal fiable séparé pour le chat et les commandes.
- **Limites connues du navigateur** : sur iPhone, pas de verrouillage du pointeur et plein écran réel seulement en PWA installée → le parcours iPhone propose « Ajouter à l'écran d'accueil » au bon moment. Certaines manettes (Switch Pro en Bluetooth, certains modes 8BitDo) sont mal lues → écran de test + remappage.

### 4.4 Serveurs : Cloudflare

- **Signalisation et salons** : Workers + **un Durable Object par salon** (WebSocket, état du salon, slots, chat). Coût quasi nul, présent dans le monde entier, et c'est la pile que tu utilises déjà pour le site de Nabil.
- **Annuaire, comptes, modération** : D1 (SQLite) + KV pour les vignettes.
- **Traversée NAT** : STUN public + **TURN Cloudflare Realtime** (0,05 $/Go, 1 000 Go gratuits par mois partagés avec le SFU). Le relai ne sert que si le direct échoue (CGNAT, réseaux d'entreprise ou d'école) ; TURN en TCP/TLS sur le port 443 pour passer partout.
- **Aucun port à ouvrir chez l'hôte**, contrairement à moonlight-web (UPnP).
- **Spectateurs nombreux (V2)** : l'hôte envoie une seule copie au SFU Cloudflare, qui redistribue. Les joueurs restent en direct.

**Ordre de grandeur des coûts** : un invité en 1080p60 ≈ 10 Mbit/s ≈ 4,5 Go/heure. Si 20 % des sessions passent par le relai, les 1 000 Go gratuits couvrent environ 1 100 heures-invité relayées par mois. Au-delà, ≈ 0,22 $ par heure-invité relayée.

**Contrainte réelle : l'upload de l'hôte.** 4 joueurs × 10 Mbit/s = 40 Mbit/s montants. L'appli mesure l'upload et propose automatiquement le bon nombre de places et la bonne qualité (fibre : large ; ADSL : 1 ou 2 invités en 720p).

### 4.5 Protocole partagé

Un paquet `protocol/` décrit une seule fois les messages (salon, slots, permissions, entrées) et génère les types Rust et TypeScript, pour que l'hôte et le client ne divergent jamais.

### 4.6 Dépôt (monorepo pnpm + Cargo)

```
couchwarp/
├── apps/
│   ├── host/        Tauri 2 : interface React + cœur Rust
│   └── web/         PWA invité + annuaire + site
├── crates/
│   ├── capture/     capture image et son par OS
│   ├── encode/      encodeurs matériels
│   ├── transport/   WebRTC (str0m), congestion, simulcast
│   └── vinput/      manettes / clavier virtuels par OS
├── services/
│   └── edge/        Workers + Durable Objects + D1
├── packages/
│   └── protocol/    schéma partagé → Rust + TS
└── docs/
```

---

## 5. Compatibilité visée

|                                     | Hôte                                | Invité                                                 |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Windows 10/11                       | **MVP**                             | Navigateur, **MVP**                                    |
| Linux (dont Steam Deck)             | V1                                  | Navigateur, **MVP**                                    |
| macOS (Apple Silicon)               | V2, manettes virtuelles incertaines | Navigateur, **MVP**                                    |
| Android                             | non                                 | Chrome, **MVP** ; appli des stores si besoin (V2)      |
| iPhone / iPad                       | non                                 | Safari + PWA, **MVP**                                  |
| TV (Android TV, Google TV, Fire TV) | non                                 | Navigateur ou PWA, V1, avec un téléphone comme manette |
| Navigateurs                         | non                                 | Chrome, Edge, Firefox, Safari, Samsung Internet        |

« Disponible en logiciel / appli » : l'hôte est une vraie appli de bureau. Pour les invités, la PWA installable **est** l'appli (icône, plein écran, notifications) ; des applis natives des stores ne valent le coup que pour la visibilité, en V2.

---

## 6. Objectifs de performance

| Mesure                                                                    | Objectif                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Latence image (de l'écran hôte à l'écran invité), même région, en filaire | < 35 ms (référence moonlight-web : ~25 ms)              |
| Même chose en LAN                                                         | < 20 ms                                                 |
| Latence d'une entrée manette (invité → jeu)                               | < ping + 2 ms                                           |
| Temps d'arrivée dans une partie (clic sur le lien → image)                | < 5 s                                                   |
| Image par défaut                                                          | 1080p60 à 10 ou 15 Mbit/s ; adaptation de 3 à 50 Mbit/s |
| Connexions réussies (direct ou relai)                                     | > 99 %                                                  |
| Charge de l'hôte en plus du jeu                                           | < 5 % CPU avec encodage matériel                        |

L'outil de mesure (image horodatée sur l'hôte, comparée à l'heure du client) se construit **dès le jalon 0** pour qu'on ne se mente jamais sur les chiffres.

---

## 7. Risques et points ouverts

| Risque                                                            | Gravité | Réponse                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manettes virtuelles sous Windows (ViGEmBus en fin de vie)         | Haute   | Couche d'abstraction ; VIIPER en premier choix, ViGEmBus en repli ; suivre libvirtualhid. À tester dès le jalon 0.                                                                                         |
| Manettes virtuelles sous macOS (entitlement Apple)                | Haute   | Hôte Mac en V2, repli clavier ; demander l'entitlement tôt.                                                                                                                                                |
| Licences                                                          | Moyenne | Ne pas lier de code GPL (Sunshine, moonlight-web, VIIPER) dans l'hôte si l'on veut garder le choix de licence ; VIIPER s'utilise comme processus séparé via son API. Vérifier la licence de libvirtualhid. |
| CLUF des jeux (streaming à des inconnus)                          | Moyenne | Pratique établie (Parsec, Steam) ; l'hôte joue _son_ exemplaire ; pas de jeux piratés dans l'annuaire ; retrait sur demande d'un éditeur.                                                                  |
| Anti-triche qui détecte les manettes virtuelles                   | Faible  | Seul le multijoueur local est visé ; liste de jeux incompatibles.                                                                                                                                          |
| Crochets injectés dans le jeu (multi-souris, faux focus)          | Moyenne | V2 seulement, désactivés par défaut et pour tout jeu avec anti-triche ; liste blanche communautaire.                                                                                                       |
| Fuite d'entrées hors du jeu (bug du filtre ou du verrou de focus) | Haute   | Tests automatiques dès le jalon 0 (alt-tab, fenêtre surgissante, combinaisons interdites) ; refuser par défaut tout ce qui est ambigu.                                                                     |
| Modération des salons publics                                     | Haute   | Pas d'annuaire public sans les outils de 3.8.                                                                                                                                                              |
| Upload de l'hôte insuffisant                                      | Moyenne | Mesure automatique, places et qualité adaptées, SFU pour les spectateurs.                                                                                                                                  |
| Ampleur du projet                                                 | Haute   | Jalons courts, chacun utilisable. Le jalon 0 décide de la suite.                                                                                                                                           |

---

## 8. Plan de construction

### Jalon 0 : preuve de latence

Objectif : répondre à « est-ce qu'on fait au moins aussi bien que moonlight-web ? ». Découpé en deux, parce que le développement se fait sur Mac et que la cible est Windows.

**0a, fait le 19/11/2026** (détails dans [ARCHITECTURE.md](ARCHITECTURE.md)) :

- Protocole partagé Rust et TypeScript, testé sur les mêmes exemples.
- Serveur de salons Cloudflare (Worker + Durable Object par salon), testé en intégration.
- Client web : code de partie, pseudo, vérification de l'appareil, vidéo, manettes, clavier, mesure de latence, navigation à la manette.
- Hôte Rust sur macOS : capture de la fenêtre (ScreenCaptureKit), H.264 matériel (VideoToolbox), WebRTC (str0m), routeur d'entrées avec filtre de touches et verrou de focus, clavier envoyé au seul processus du jeu.
- Mesuré en local : 28 ms de la capture à l'affichage en médiane, 40 ms pour 95 % des images.

**0b, en cours** :

- Fait : hôte Windows (capture WGC, encodage OpenH264, manettes VIIPER, clavier SendInput, son WASAPI, verrou de focus), compilé et testé par l'intégration continue sur Windows.
- Fait en avance (jalon 1) : son du jeu, clavier joué comme une manette, manette tactile.
- À faire : premier essai sur `kiyoni` avec VIIPER, banc d'essai moonlight-web pour comparer, encodeurs matériels Windows.
- **Critère de sortie** : < 40 ms sur Internet entre deux réseaux différents, 2 manettes qui jouent en même temps.

### Jalon 1 : MVP entre amis (6 à 8 semaines)

- Appli hôte Tauri : choix du jeu, son du jeu seul, salon privé, slots par glisser-déposer, permissions, expulsion, pause automatique, pare-feu clavier, overlay.
- PWA invité : lien / code / QR, pseudo, vérification en 3 s, manettes physiques multiples, manette tactile, plein écran, indicateur de latence.
- Cloudflare : Durable Object par salon, TURN.
- **Critère de sortie** : une soirée Overcooked à 4 avec des amis sur Windows, Mac, Android et iPhone, sans aide.

### Jalon 2 : V1 publique

Annuaire avec vignettes live et ping estimé, comptes facultatifs, amis, modération, rotation des manettes, salle d'attente, mode turbo WebCodecs, simulcast, écran virtuel, hôte Linux, téléphone-manette + télé-écran, bot Discord, notifications.

### Jalon 3 : V2

Hôte macOS, SFU pour les spectateurs, clips, parties programmées, tournois, gyroscope et volants, HDR / 120 i/s, applis des stores.

---

## 9. Sources

- Fermeture et fonctionnement d'Arcade : [annonce Parsec](https://parsec.app/blog/were-moving-the-party-to-the-arcade-c6dc01d4ec40/), [Party Finder](https://parsec.app/blog/party-finder-for-local-multiplayer-game-matchmaking-online-co-op-9bfe6ffbc13d), [permissions Parsec](https://support.parsec.app/hc/en-us/articles/4422936497165-Hosting-and-Permissions), [aide Arcade](https://support.parsec.app/hc/en-us/articles/32381349945492-Arcade)
- Outils communautaires : [Smash Soda](https://github.com/mickeyuk/smash-soda), son wiki ([Keyboard](https://github.com/MickeyUK/SmashSoda/wiki/Keyboard), [Kiosk Mode](https://github.com/MickeyUK/SmashSoda/wiki/Kiosk-Mode), [Hotseat](https://github.com/MickeyUK/SmashSoda/wiki/Hotseat)), [Parsec Soda](https://github.com/FlavioFS/ParsecSoda), [FAQ Game Sessions for Parsec](https://parsec.sierron.de/faq)
- Plusieurs claviers et souris : [ProtoInput](https://github.com/zzeck/protoinput), [doc ProtoInput (SplitScreen.Me)](https://www.splitscreen.me/docs/proto/), [Nucleus Co-op](https://github.com/nucleuscoop/nucleuscoop/blob/master/README.md)
- Steam : [Remote Play Together sans Steam (PC Gamer)](https://pcgamer.com/steam-remote-play-together-now-works-with-people-who-dont-have-steam), [GamingOnLinux](https://www.gamingonlinux.com/2021/03/steam-remote-play-together-invite-anyone-is-out-of-beta-new-steam-client-up)
- Référence technique : [moonlight-web](https://github.com/linckosz/moonlight-web), [Apollo](https://github.com/ClassicOldSong/Apollo), [Wolf](https://games-on-whales.github.io/wolf/stable), [Lumen (hôte macOS)](https://github.com/trollzem/Lumen)
- Manettes virtuelles : [Sunshine : remplacer ViGEmBus](https://github.com/LizardByte/roadmap/issues/10), [libvirtualhid](https://app.lizardbyte.dev/2026-08-16-introducing-libvirtualhid-and-virtual-hid-driver/?lng=en-US), [VIIPER](https://github.com/Alia5/VIIPER), [Karabiner DriverKit](https://www.github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice), [entitlement HID virtuel Apple](https://developer.apple.com/forums/thread/840311), [Moonshine (uinput)](https://github.com/hgaiser/moonshine)
- Navigateur : [WebCodecs, WebTransport et WebRTC (webrtcHacks)](https://webrtchacks.com/webcodecs-webtransport-and-webrtc/), [API web 2026](https://www.utsubo.com/blog/frontier-web-apis-2026-production-ready), [PWA sur iOS](https://firt.dev/notes/pwa-ios/), [Pointer Lock iOS (WebKit)](https://bugs.webkit.org/show_bug.cgi?id=272136)
- Réseau : [tarifs Cloudflare Realtime](https://developers.cloudflare.com/realtime/sfu/pricing), [FAQ TURN Cloudflare](https://developers.cloudflare.com/realtime/turn/faq/), [str0m](https://docs.rs/crate/str0m/latest)
- Discord : [Activities : réseau (pas de WebRTC)](https://docs.discord.com/developers/activities/development-guides/networking)
