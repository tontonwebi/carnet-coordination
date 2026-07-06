# 🌿 Carnet de coordination

Application web simple et **gratuite** pour coordonner l'accompagnement d'un enfant entre
la famille, l'IME et les intervenants (orthophoniste, psychomotricien…).

- Suivi des **objectifs** avec graphiques d'évolution
- **Tableau de bord** qui met en évidence les objectifs peu travaillés
- Saisie **rapide par boutons** (peu de clavier)
- Page **« Qui fait quoi ? »** et **calendrier** des réunions
- **Synthèse PAP** générée automatiquement
- Données dans **un seul fichier partagé** (Google Drive) — aucune base de données,
  aucune inscription, rien n'est envoyé sur un serveur.

Aucune dépendance : trois fichiers (`index.html`, `styles.css`, `app.js`) qui fonctionnent
même hors-ligne.

> ℹ️ Cette version en ligne est **anonymisée** (données d'exemple génériques). Le prénom et
> les vraies informations n'apparaissent que dans **votre** fichier privé sur Drive, jamais
> sur la page publique.

---

## 1. Utiliser l'application en local

Double-cliquez sur **`index.html`** : l'appli s'ouvre dans le navigateur.
Les données sont mémorisées dans le navigateur (localStorage) et peuvent être
**exportées / importées** via la barre du bas.

> 💡 Pour le vrai partage entre plusieurs personnes, voir la section **Fichier partagé**.

---

## 2. Mettre à jour la version en ligne (GitHub Pages)

Le site est publié via **GitHub Pages** à partir de la branche `main` de ce dépôt.
Pour publier une modification :

- **En ligne** : **Add file → Upload files**, glissez les fichiers modifiés, **Commit changes**.
- **En ligne de commande** :
  ```bash
  git add -A
  git commit -m "Mise à jour du carnet"
  git push
  ```

GitHub Pages se met à jour automatiquement en ~1 minute.

Adresse publique : `https://VOTRE-IDENTIFIANT.github.io/carnet-coordination/`

---

## 3. Le fichier partagé (données communes)

L'application est **statique** : elle ne stocke rien sur un serveur. Pour que tout le monde
voie les **mêmes** données, on utilise **un seul fichier `carnet_coordination.json`** déposé
sur un espace partagé (par ex. un dossier **Google Drive** synchronisé sur l'ordinateur).

### Mise en place (une fois)
1. Ouvrez l'appli, cliquez **⬇️ Exporter** → vous obtenez `carnet_coordination.json`.
2. Déposez ce fichier dans le dossier Google Drive partagé.

### Au quotidien (Chrome ou Edge sur ordinateur)
- **📂 Ouvrir le fichier** → sélectionnez `carnet_coordination.json` sur le Drive.
- Travaillez normalement (ajout de séances, objectifs…).
- **💾 Enregistrer** → réécrit dans le **même** fichier partagé.

L'appli **prévient** si le fichier a été modifié par quelqu'un d'autre depuis votre dernière
ouverture (protection contre l'écrasement).

### Sur mobile ou autres navigateurs
Les boutons 📂/💾 ne sont pas disponibles : utilisez **⬇️ Exporter** et **⬆️ Importer**
avec le fichier du Drive.

> ⚠️ Bonne pratique : **une personne enregistre à la fois**. Ouvrez → modifiez →
> enregistrez, plutôt que de laisser le fichier ouvert longtemps.

---

## 4. Confidentialité

Les données restent **dans votre navigateur** et **dans votre fichier** (votre Drive).
Rien n'est transmis à un serveur tiers par l'application. Le partage dépend uniquement
de l'endroit où vous déposez le fichier `.json`.

La page publique ne contient **aucune donnée réelle** : uniquement des exemples génériques.

---

## 5. Structure des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure et onglets |
| `styles.css` | Mise en forme (couleurs douces, responsive, impression) |
| `app.js` | Logique : données, rendu, graphiques, fichier partagé |
| `data.example.json` | Jeu de données d'exemple (importable pour tester) |

Compatible avec les exports de la **V1** : importez l'ancien fichier `.json` via le bouton
**⬆️ Importer**, il est converti automatiquement.
