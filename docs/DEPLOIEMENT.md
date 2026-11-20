# Mise en ligne

En production : https://couchwarp.sachapastor34.workers.dev (base D1 `couchwarp` en Europe de l'Ouest).

Le site, les salons et la base tournent sur Cloudflare (Workers, Durable Objects, D1). Un seul Worker sert le client web et l'API.

## 1. Compte Cloudflare

```sh
cd services/edge
pnpm exec wrangler login
pnpm exec wrangler d1 create couchwarp
```

Recopie l'identifiant affiché dans `database_id` de `services/edge/wrangler.jsonc`, puis crée les tables :

```sh
pnpm db:migrate:remote
```

## 2. Secrets

Chaque valeur se donne une fois, sans jamais l'écrire dans le dépôt :

```sh
pnpm exec wrangler secret put DISCORD_CLIENT_ID
pnpm exec wrangler secret put DISCORD_CLIENT_SECRET
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put ADMIN_USER_IDS
```

Facultatif : `TURN_KEY_ID` et `TURN_KEY_API_TOKEN` (relais Cloudflare Realtime) pour les invités derrière un réseau fermé et pour l'option « Masquer les adresses ».

Réglages non secrets, dans `vars` de `wrangler.jsonc` ou avec `wrangler secret put` :

| Nom            | Valeur                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`   | Adresse du site, par exemple `https://couchwarp.<sous-domaine>.workers.dev`                        |
| `PUBLIC_ROOMS` | `on` pour ouvrir la liste publique. Laisse-la fermée tant que personne ne traite les signalements. |

`ADMIN_USER_IDS` prend les identifiants de compte (champ `id` de `/api/me`), séparés par des virgules.

Pour le développement, les mêmes noms vont dans `services/edge/.dev.vars`, ignoré par git (modèle : `.dev.vars.example`).

## 3. Pages légales

Avant l'ouverture au public, donne l'éditeur et le contact affichés sur `/terms` et `/privacy`, dans `apps/web/.env` :

```sh
VITE_PUBLISHER="Prénom Nom"
VITE_CONTACT_EMAIL="contact@exemple.fr"
```

## 4. Déployer

```sh
pnpm run deploy
```

(`pnpm deploy` sans `run` est une autre commande de pnpm.)

## 5. Discord et Google

Une fois l'adresse du site connue :

- **Discord** (Developer Portal > ton application > OAuth2 > Redirects) : ajoute `<PUBLIC_URL>/api/auth/discord/callback`. Dans General Information, renseigne les liens `<PUBLIC_URL>/terms` et `<PUBLIC_URL>/privacy` (les anciennes adresses `/conditions` et `/confidentialite` y mènent aussi).
- **Google** (Google Auth Platform) :
  - Clients > Couchwarp web > Authorized redirect URIs : ajoute `<PUBLIC_URL>/api/auth/google/callback`.
  - Branding : page d'accueil `<PUBLIC_URL>/`, confidentialité et conditions comme ci-dessus, domaine autorisé.
  - Audience : « Publish app » quand le site est prêt. Avec les seules permissions `openid` et `profile`, Google ne demande pas de vérification, sauf si un logo est ajouté.

## 6. Application et hôte

L'application montre le site écrit dans `apps/desktop/src-tauri/tauri.conf.json` (`build.frontendDist`) et l'autorise dans `capabilities/site.json` : change les deux si l'adresse change. L'adresse des mises à jour (`plugins.updater.endpoints`) suit la même règle.

### Publier une version

1. Monte la version au même numéro dans `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` et `apps/desktop/package.json`.
2. Pousse l'étiquette : `git tag v0.1.1 && git push origin v0.1.1`.
3. GitHub Actions (`.github/workflows/release.yml`) construit l'appli Mac (Apple Silicon) et Windows, puis publie la version GitHub avec le `.dmg`, l'installateur `.exe`, les fichiers de mise à jour signés et `latest.json`. Le travail échoue si l'étiquette ne correspond pas à la version.

Les applis installées regardent au démarrage puis toutes les 4 heures. Quand une version est sortie, un bouton vert « Mettre à jour » apparaît en haut à droite : un clic télécharge, installe et redémarre.

### Secrets

Sur GitHub (Settings > Secrets and variables > Actions) :

- `TAURI_SIGNING_PRIVATE_KEY` : la clé privée des mises à jour. Sa moitié publique est `plugins.updater.pubkey` dans `tauri.conf.json`. Si on la perd, les applis déjà installées ne pourront plus se mettre à jour : il faut en garder une copie dans Bitwarden. Nouvelle clé : `pnpm --filter @couchwarp/desktop tauri signer generate -w .keys/couchwarp-updater.key` (le dossier `.keys/` est ignoré par git), puis remplacer `pubkey`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : seulement si la clé a un mot de passe.

Sur Cloudflare : les applis ne lisent pas GitHub directement, elles passent par le site (`/api/updates/latest.json`, voir `services/edge/src/updates.ts`). Tant que le dépôt (`RELEASES_REPO` dans `wrangler.jsonc`) est privé, le site a besoin d'un jeton GitHub en lecture seule. Crée-le dans GitHub > Settings > Developer settings > Fine-grained tokens, avec le seul dépôt Couchwarp et la permission « Contents: Read-only », puis :

```sh
pnpm --filter @couchwarp/edge exec wrangler secret put RELEASES_TOKEN
```

Avec ce jeton, la page Héberger propose aussi les installateurs de la dernière version. Des adresses ailleurs restent possibles avec `DOWNLOAD_MAC_URL` et `DOWNLOAD_WINDOWS_URL`, qui passent alors en priorité.

### Construire sur le Mac

```sh
pnpm --filter @couchwarp/desktop build:mac
```

Le script signe les fichiers de mise à jour avec `.keys/couchwarp-updater.key` ; sans ce fichier, utilise `pnpm --filter @couchwarp/desktop tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`.

L'appli est dans `target/release/bundle/macos/Couchwarp.app`.

Sans signature, macOS bloque l'application au premier lancement (clic droit > Ouvrir) et Windows affiche SmartScreen (Informations complémentaires > Exécuter quand même).

L'hôte en ligne de commande pointe vers le site avec `--server <PUBLIC_URL>`, et se connecte une fois avec `couchwarp-host login --server <PUBLIC_URL>`.

## Données

Une tâche planifiée (`triggers.crons` dans `wrangler.jsonc`) efface chaque nuit les sessions expirées, l'historique et le journal de modération de plus d'un an, et les demandes d'ami sans réponse depuis 90 jours. Ces durées sont celles de la page Confidentialité : change les deux ensemble.
