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

Le relais et les e-mails ont chacun leur section ci-dessous.

Réglages non secrets, dans `vars` de `wrangler.jsonc` ou avec `wrangler secret put` :

| Nom            | Valeur                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`   | Adresse du site, par exemple `https://couchwarp.<sous-domaine>.workers.dev`                  |
| `PUBLIC_ROOMS` | `on` (réglage actuel) ouvre la liste publique ; `off` la ferme, les parties restent privées. |

`ADMIN_USER_IDS` prend les identifiants de compte (champ `id` de `/api/me`), séparés par des virgules.

Pour le développement, les mêmes noms vont dans `services/edge/.dev.vars`, ignoré par git (modèle : `.dev.vars.example`).

### Relais : cacher l'adresse IP des invités

Sans relais, un invité se connecte directement au PC de l'hôte, qui voit son adresse IP, et certains réseaux (4G, entreprise, école) ne passent pas. Avec un relais, l'option « Cacher l'adresse IP des invités » est cochée par défaut dans chaque partie privée, et toujours appliquée dans une partie publique.

**Le plus simple : le relais de Cloudflare.** Tableau de bord Cloudflare > Realtime > TURN Server > Create, puis :

```sh
pnpm --filter @couchwarp/edge exec wrangler secret put TURN_KEY_ID
pnpm --filter @couchwarp/edge exec wrangler secret put TURN_KEY_API_TOKEN
```

**Ou un relais à soi (coturn)**, sur une machine joignable depuis Internet (adresse publique, ports ouverts) : 3478 en UDP et TCP, 5349 en TCP pour TLS, et la plage de relais en UDP. Exemple avec Docker :

```yaml
services:
  coturn:
    image: coturn/coturn:4.6
    network_mode: host
    restart: unless-stopped
    command: >
      --realm=couchwarp --use-auth-secret --static-auth-secret=${TURN_SECRET}
      --listening-port=3478 --min-port=49160 --max-port=49200
      --no-cli --no-tlsv1 --no-tlsv1_1 --fingerprint
      --denied-peer-ip=10.0.0.0-10.255.255.255 --denied-peer-ip=172.16.0.0-172.31.255.255
      --denied-peer-ip=192.168.0.0-192.168.255.255 --denied-peer-ip=100.64.0.0-100.127.255.255
```

Les `denied-peer-ip` empêchent qu'on se serve du relais pour atteindre le réseau local de la machine. Donne ensuite au site l'adresse et le même secret (le secret ne quitte jamais le serveur : il signe des identifiants valables 12 heures) :

```sh
pnpm --filter @couchwarp/edge exec wrangler secret put TURN_URLS     # turn:relais.exemple.fr:3478?transport=udp,turn:relais.exemple.fr:3478?transport=tcp
pnpm --filter @couchwarp/edge exec wrangler secret put TURN_SECRET
```

### E-mails : confirmation d'adresse et mot de passe oublié

Les comptes avec mot de passe confirment leur adresse par un lien, et récupèrent un mot de passe oublié par e-mail. Le site envoie les e-mails par [Resend](https://resend.com) (gratuit jusqu'à 3 000 e-mails par mois), depuis un nom de domaine à toi vérifié chez Resend (enregistrements DNS SPF et DKIM qu'il indique) :

```sh
pnpm --filter @couchwarp/edge exec wrangler secret put RESEND_API_KEY
pnpm --filter @couchwarp/edge exec wrangler secret put MAIL_FROM      # Couchwarp <no-reply@ton-domaine.fr>
```

Sans ces deux valeurs, l'inscription marche toujours, mais aucun e-mail ne part : le lien est seulement écrit dans les journaux du Worker, et la page « Mot de passe oublié » dit que ce n'est pas encore disponible. En local, le lien s'affiche dans le terminal de `pnpm dev`.

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
2. Pousse l'étiquette : `git tag v0.2.0 && git push origin v0.2.0`.
3. GitHub Actions (`.github/workflows/release.yml`) construit l'appli Mac (Apple Silicon), Windows et Linux (x86-64, sur Ubuntu 22.04), puis publie la version GitHub avec le `.dmg`, l'installateur `.exe`, l'`.AppImage`, le `.deb`, les fichiers de mise à jour signés et `latest.json`. Ce manifeste est écrit en dernier, une fois les trois constructions finies, à partir des signatures publiées. Le travail échoue si l'étiquette ne correspond pas à la version.

Sous Linux, l'AppImage se met à jour toute seule ; le `.deb` se met à jour en installant le suivant.

Les applis installées regardent au démarrage puis toutes les 4 heures. Quand une version est sortie, un bouton vert « Mettre à jour » apparaît en haut à droite : un clic télécharge, installe et redémarre. Paramètres > Application montre la version installée ; « Rechercher une mise à jour » regarde tout de suite, sans attendre la prochaine fois.

### Secrets

Sur GitHub (Settings > Secrets and variables > Actions) :

- `TAURI_SIGNING_PRIVATE_KEY` : la clé privée des mises à jour. Sa moitié publique est `plugins.updater.pubkey` dans `tauri.conf.json`. Si on la perd, les applis déjà installées ne pourront plus se mettre à jour : il faut en garder une copie dans Bitwarden. Nouvelle clé : `pnpm --filter @couchwarp/desktop tauri signer generate -w .keys/couchwarp-updater.key` (le dossier `.keys/` est ignoré par git), puis remplacer `pubkey`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : seulement si la clé a un mot de passe.
- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` : le certificat qui signe l'appli Mac. Une seule commande les crée et les enregistre : `apps/desktop/scripts/macos-signing-certificate.sh`. Garde-le : c'est parce que la signature reste la même d'une version à l'autre que macOS garde les autorisations Enregistrement de l'écran et Accessibilité après une mise à jour. Les versions signées « ad hoc » (avant 0.2.0) étaient vues comme une nouvelle appli à chaque mise à jour ; l'appli propose « Réparer » pour effacer l'ancienne autorisation restée cochée.

Sur Cloudflare : les applis ne lisent pas GitHub directement, elles passent par le site (`/api/updates/latest.json`, voir `services/edge/src/updates.ts`). Le dépôt (`RELEASES_REPO` dans `wrangler.jsonc`) est public : le site lit ses versions sans jeton, et `RELEASES_TOKEN` peut être supprimé. S'il redevenait privé, le site aurait besoin d'un jeton GitHub en lecture seule. Crée-le dans GitHub > Settings > Developer settings > Fine-grained tokens, avec le seul dépôt Couchwarp et la permission « Contents: Read-only », puis :

```sh
pnpm --filter @couchwarp/edge exec wrangler secret put RELEASES_TOKEN
```

La page Héberger propose aussi les installateurs de la dernière version. Des adresses ailleurs restent possibles avec `DOWNLOAD_MAC_URL` et `DOWNLOAD_WINDOWS_URL`, qui passent alors en priorité.

### Construire sur le Mac

```sh
pnpm --filter @couchwarp/desktop build:mac
```

Le script signe les fichiers de mise à jour avec `.keys/couchwarp-updater.key` ; sans ce fichier, utilise `pnpm --filter @couchwarp/desktop tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`.

L'appli est dans `target/release/bundle/macos/Couchwarp.app`.

Sans certificat Apple Developer ID payant, macOS bloque l'application au premier lancement (clic droit > Ouvrir) ; sans certificat Windows, Windows affiche SmartScreen (Informations complémentaires > Exécuter quand même).

L'hôte en ligne de commande pointe vers le site avec `--server <PUBLIC_URL>`, et se connecte une fois avec `couchwarp-host login --server <PUBLIC_URL>`.

## Données

Une tâche planifiée (`triggers.crons` dans `wrangler.jsonc`) efface chaque nuit les sessions et liens d'e-mail expirés, les compteurs anti-abus de plus d'un jour, l'historique et le journal de modération de plus d'un an, et les demandes d'ami sans réponse depuis 90 jours. Ces durées sont celles de la page Confidentialité : change les deux ensemble.
