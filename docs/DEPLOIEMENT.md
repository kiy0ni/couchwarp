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

Avant l'ouverture au public, donne l'éditeur et le contact affichés sur `/conditions` et `/confidentialite`, dans `apps/web/.env` :

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

- **Discord** (Developer Portal > ton application > OAuth2 > Redirects) : ajoute `<PUBLIC_URL>/api/auth/discord/callback`. Dans General Information, renseigne les liens `<PUBLIC_URL>/conditions` et `<PUBLIC_URL>/confidentialite`.
- **Google** (Google Auth Platform) :
  - Clients > Couchwarp web > Authorized redirect URIs : ajoute `<PUBLIC_URL>/api/auth/google/callback`.
  - Branding : page d'accueil `<PUBLIC_URL>/`, confidentialité et conditions comme ci-dessus, domaine autorisé.
  - Audience : « Publish app » quand le site est prêt. Avec les seules permissions `openid` et `profile`, Google ne demande pas de vérification, sauf si un logo est ajouté.

## 6. Application et hôte

L'application montre le site écrit dans `apps/desktop/src-tauri/tauri.conf.json` (`build.frontendDist`) et l'autorise dans `capabilities/site.json` : change les deux si l'adresse change.

Pour construire les installateurs, pousse une étiquette (`git tag v0.1.0 && git push --tags`) : GitHub Actions crée une version brouillon avec le `.dmg` et le `.exe`. Héberge ces fichiers où les visiteurs peuvent les télécharger, puis donne leurs adresses au site, qui les affiche sur la page Héberger :

```sh
wrangler secret put DOWNLOAD_MAC_URL
wrangler secret put DOWNLOAD_WINDOWS_URL
```

Sans signature, macOS bloque l'application au premier lancement (clic droit > Ouvrir) et Windows affiche SmartScreen (Informations complémentaires > Exécuter quand même).

L'hôte en ligne de commande pointe vers le site avec `--server <PUBLIC_URL>`, et se connecte une fois avec `couchwarp-host login --server <PUBLIC_URL>`.

## Données

Une tâche planifiée (`triggers.crons` dans `wrangler.jsonc`) efface chaque nuit les sessions expirées, l'historique et le journal de modération de plus d'un an, et les demandes d'ami sans réponse depuis 90 jours. Ces durées sont celles de la page Confidentialité : change les deux ensemble.
