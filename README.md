# Roller Flow

Application web complete pour calculer le debit d'un roller coaster, enregistrer les calculs et administrer les donnees.

## Fonctionnalites

- Calcul du debit avec la formule `personnes par train x 30 x trains en 2 minutes`
- Resultat affiche a droite du formulaire
- Validation des champs cote client et cote serveur
- Limite visiteur a 2 calculs par jour par adresse IP
- Creation de compte utilisateur avec connexion
- Historique personnel pour chaque utilisateur connecte
- Changement de mot de passe depuis l'espace utilisateur
- Tableau d'administration prive
- Suppression des enregistrements abusifs
- Bannissement et levee de ban des adresses IP
- Export Excel `.xlsx` du tableau admin avec date et heure
- Compte admin cree automatiquement : `Admin` / `admin`

## Stack

- Node.js
- Express
- EJS
- SQLite via `better-sqlite3`
- Sessions serveur
- Export Excel via `xlsx`

## Installation locale

1. Installer les dependances :

   ```bash
   npm install
   ```

2. Copier le fichier d'environnement :

   ```bash
   cp .env.example .env
   ```

3. Modifier `SESSION_SECRET` dans `.env`.

4. Lancer l'application :

   ```bash
   npm run dev
   ```

## Variables d'environnement

- `PORT` : port HTTP de l'application
- `SESSION_SECRET` : secret des sessions
- `APP_TIMEZONE` : fuseau pour la date et l'heure enregistrees
- `TRUST_PROXY` : mettre `true` derriere un reverse proxy VPS
- `SESSION_COOKIE_SECURE` : mettre `true` uniquement quand le site est servi en HTTPS

## Deploiement sur VPS Ubuntu 22.04

1. Installer Node.js LTS et les outils natifs utiles a `better-sqlite3` :

   ```bash
   sudo apt update
   sudo apt install -y curl build-essential python3
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

2. Cloner le depot GitHub sur le VPS.

3. Installer les dependances :

   ```bash
   npm install
   ```

4. Creer le fichier `.env` :

   ```bash
   cp .env.example .env
   ```

5. Definir au minimum :

   ```env
   PORT=3000
   SESSION_SECRET=change-me-vraiment
   APP_TIMEZONE=Europe/Paris
   TRUST_PROXY=true
   SESSION_COOKIE_SECURE=false
   ```

6. Lancer avec PM2 :

   ```bash
   npm install -g pm2
   pm2 start server.js --name roller-flow
   pm2 save
   pm2 startup
   ```

7. Mettre Nginx devant l'application avec proxy vers `http://127.0.0.1:3000`.

## Securite

- Le compte admin `Admin / admin` est cree automatiquement a la premiere execution car vous l'avez demande
- Changez ce mot de passe immediatement apres le premier lancement en production
- Le tableau complet n'est accessible qu'a l'administrateur
- Les visiteurs non connectes sont limites et controles par IP

## Donnees

- La base SQLite est creee automatiquement dans `data/app.db`
- Les sessions sont stockees dans `data/sessions/`
- Le fichier Excel est genere a la demande depuis `/admin/export.xlsx`
