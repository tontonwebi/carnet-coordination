# 🌸 Carnet de coordination

Application web pour coordonner l'accompagnement d'un enfant entre la famille, l'IME et les
intervenants (orthophoniste, psychomotricien…).

- Suivi des **objectifs** avec graphiques d'évolution
- **Tableau de bord** qui met en évidence les objectifs peu travaillés
- Saisie **rapide par boutons**
- Page **« Qui fait quoi ? »**, **calendrier**, **synthèse PAP** automatique
- **Stockage partagé en ligne** (Cloudflare KV) : tout le monde voit et modifie les mêmes
  données, en direct — plus aucun fichier à s'échanger.
- **Accès protégé par mot de passe**, vérifié côté serveur.

## Architecture

| Élément | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | L'application (statique) |
| `functions/api/data.js` | Fonction Cloudflare Pages : lit/écrit les données dans KV (`/api/data`) |
| **Cloudflare KV** | Base qui stocke le carnet (un seul document JSON) |

⚠️ **Cette version nécessite Cloudflare Pages** (avec Functions + KV). Elle ne fonctionne
**pas** sur un hébergement purement statique (GitHub Pages, Netlify Drop), qui ne peut pas
exécuter la fonction serveur ni la base KV.

---

## Déploiement sur Cloudflare Pages

### 1. Créer la base KV
1. Tableau de bord Cloudflare → **Storage & Databases → KV** → **Create namespace**.
2. Nom : `carnet_data` (ou ce que vous voulez) → **Add**.

### 2. Déployer l'application
- **Direct Upload** : Workers & Pages → votre projet Pages → **Create/Upload** le ZIP
  (`carnet-coordination-netlify.zip`, qui contient bien le dossier `functions/`).
- **ou via Git** si le dépôt est connecté (push automatique).

### 3. Brancher la base + le mot de passe
Dans le projet Pages → **Settings** :
- **Functions → KV namespace bindings** → **Add binding** :
  - Variable name : **`CARNET_KV`** (exactement)
  - KV namespace : `carnet_data`
  - (à faire pour **Production** ; idéalement aussi **Preview**)
- **Environment variables (secrets)** → **Add** :
  - Name : **`APP_PW_HASH`**
  - Value : l'empreinte SHA-256 du mot de passe partagé *(fournie par votre développeur)*
  - Type : **Secret** (chiffré)

### 4. Redéployer
Après avoir ajouté les bindings, **relancez un déploiement** (Deployments → Retry deployment,
ou re-uploadez le ZIP) pour qu'ils prennent effet.

➡️ Le site est prêt : `https://<votre-projet>.pages.dev` demande le mot de passe, puis
charge les données partagées.

---

## Mot de passe

- L'accès est protégé par un **mot de passe partagé**, **vérifié côté serveur** :
  le code public ne contient **jamais** l'empreinte attendue (elle est dans la variable
  secrète `APP_PW_HASH`). Le navigateur envoie seulement l'empreinte de ce qui est tapé.
- Option **« Se souvenir sur cet appareil »**.
- **Changer le mot de passe** : recalculer l'empreinte et mettre à jour `APP_PW_HASH`
  (le « sel » utilisé est dans `app.js`, constante `GATE_SALT`). Demandez à votre développeur.

Pour une protection encore plus forte (connexion par e-mail, journal des accès), on peut
ajouter **Cloudflare Access** (gratuit jusqu'à 50 personnes) par-dessus.

---

## Confidentialité

- Les données sont stockées dans **Cloudflare KV** (service tiers). À **cadrer côté RGPD**
  avec l'IME si de vraies données nominatives y sont saisies.
- Rien n'est envoyé ailleurs par l'application.
- La barre du bas permet de **télécharger une sauvegarde** (`⬇️`) et de **restaurer** (`⬆️`)
  à tout moment.

---

## Développement local

```bash
npx wrangler pages dev . --kv CARNET_KV --binding APP_PW_HASH=<empreinte>
```
Ouvre l'appli sur `http://localhost:8788` avec une base KV simulée en local.
