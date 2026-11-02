# Taxi Saint-Irénée · site et espace client

Site de Taxi Saint-Irénée, taxi conventionné à Lyon et dans la métropole depuis 2014, en français et en anglais.
Charte graphique respectée : logos vectoriels extraits de la charte (jamais retapés), palette noir / taupe / sable / crème, typographie Jost (hébergée sur le site).

## Ce qu'il y a dedans

| Page | Français | Anglais |
|---|---|---|
| Accueil, avec réservation rapide | `/` | `/en` |
| Prestations (ville, familles et groupes, longues distances, mise à disposition, entreprises) | `/prestations` | `/en/services` |
| Aéroport & gares | `/aeroport-gares` | `/en/airport-stations` |
| Transport conventionné CPAM | `/conventionne` | `/en/medical-transport` |
| À propos | `/a-propos` | `/en/about` |
| Contact, formulaire et questions fréquentes | `/contact` | `/en/contact` |
| Réservation en 3 étapes, avec ou sans compte | `/reserver` | `/en/book` |
| Mentions légales et confidentialité | `/mentions-legales` | `/en/legal` |
| Espace client : aperçu, trajets, factures, assistant, profil | `/compte` | |
| Facture imprimable / PDF | `/facture?id=…` | |
| Espace chauffeur (privé) | `/chauffeur` | |
| QR code permanent (redirection) | `/qr` | |

Un bouton **EN / FR** dans l'en-tête passe d'une langue à l'autre sur la page équivalente ; un visiteur dont le navigateur est en anglais se voit proposer la version anglaise. Le site fonctionne aussi **hors connexion** : les pages déjà vues restent consultables et, sans réseau, une page affiche le numéro de téléphone.

**Fonctionnement d'une réservation**

1. Le client fait sa demande en ligne (sans compte, ou avec compte : ses coordonnées et adresses sont pré-remplies). Aucun prix, aucun paiement en ligne. Une distance et une durée indicatives s'affichent quand c'est possible (calcul IGN, jamais de tarif).
2. Le chauffeur reçoit une notification sur son téléphone et un e-mail « [NOUVELLE RÉSERVATION] » auquel il peut répondre directement au client. Il voit la demande dans `/chauffeur`, rappelle le client, puis clique sur **Confirmer**.
3. Après la course, il clique sur **Terminer · facture** et saisit le montant du compteur. La facture (F2026-0001, F2026-0002…) apparaît dans l'espace du client et lui est envoyée par e-mail.
4. Une course prise par téléphone peut aussi être saisie dans `/chauffeur` et rattachée au compte du client.

Chaque demande reçoit une référence du type `TSI-261102-PSY2`. Si l'envoi échoue (réseau coupé), le formulaire propose d'appeler ou d'envoyer la demande par e-mail, déjà rédigée.

**Transport médical conventionné** (repris de l'ancien site) : le client choisit « Transport médical », indique l'**heure du rendez-vous** (le chauffeur calcule l'heure de prise en charge), l'état de sa **prescription** (je l'ai, elle me sera remise, je n'en ai pas → course à ses frais), un **retour sans heure fixe** possible et les **transports réguliers** (séances de soins). Les hôpitaux de Lyon sont proposés en raccourci. Aucune information de santé n'est demandée ; le rappel « prescription et carte Vitale » figure sur l'écran final et dans l'e-mail.

**Fidélité** : chaque course terminée (hors transport conventionné) compte. Au bout de `LOYALTY_STEP` courses, l'avantage `LOYALTY_REWARD` est disponible ; le chauffeur le coche au moment de la facture.

**Assistant** : il analyse les trajets du client (lieux fréquents, trajets réguliers par jour et heure, aller-retour, dépenses, fidélité) et propose de réserver le prochain trajet habituel en un geste. Sans clé API, il fonctionne avec l'analyse intégrée ; avec une clé Claude, il répond en langage naturel à n'importe quelle question du client sur ses déplacements.

## QR code permanent

Le QR code contient toujours la même adresse : `<adresse du site>/qr`. Cette adresse redirige vers la destination choisie dans l'espace chauffeur, onglet **QR code**. La destination est un **lien complet, modifiable à volonté** : une page du site, un futur nom de domaine (`https://www.mon-nouveau-domaine.fr/reserver`), WhatsApp, une fiche Google… Le QR code imprimé suit immédiatement, **sans jamais être réimprimé**.

- **L'adresse imprimée est figée** au premier lancement du site en ligne (enregistrée dans la base). Si vous prenez plus tard un nom de domaine, le QR code continue de pointer vers l'ancienne adresse, qui redirige vers le lien que vous aurez choisi. Il suffit que cette ancienne adresse reste en service : chez Render, Railway ou Fly.io, l'adresse gratuite du type `taxi-saint-irenee.onrender.com` reste active même après l'ajout d'un nom de domaine.
- Pour imposer l'adresse imprimée (par exemple directement le nom de domaine définitif), définir `QR_BASE_URL=https://www.votre-domaine.fr/qr` **avant** d'imprimer.
- Tant que le site tourne en local, l'onglet affiche « Adresse provisoire » : n'imprimez pas à ce moment-là.
- Télécharger le QR code : espace chauffeur → QR code → *Télécharger pour l'imprimeur (SVG)* ou *en image (PNG)*. Ou en ligne de commande : `npm run qr` (crée les trois versions dans `qr/`).
- Trois versions : **fond noir** pour la voiture (crème sur noir), **fond noir avec cadre crème** (lisible par absolument tous les lecteurs) et **fond crème** pour les cartes et documents.
- Sur la voiture : au moins 12 à 15 cm de côté pour une lecture à un ou deux mètres, en vinyle mat (les reflets gênent la lecture). Le marquage d'un taxi se fait valider par la mairie ou la préfecture.
- Le nombre de scans et la date du dernier scan s'affichent dans l'onglet (aucune donnée personnelle n'est enregistrée).

## Lancer le site sur un ordinateur

Il faut Node.js 20 ou plus récent.

```bash
cd taxi-saint-irenee
npm install
cp .env.example .env      # puis remplir au moins DRIVER_PASSWORD
npm start                 # → http://localhost:3000
npm test                  # vérifie pages, réservation, comptes, factures, QR code
```

### Essayer avec des données de démonstration

```bash
DATA_FILE=demo.json npm run seed:demo
DATA_FILE=demo.json npm start
```

Espace client : `claire.martin@exemple.fr` / `demo-taxi-2026` (une patiente qui va en radiothérapie chaque mardi, avec des trajets aéroport et gare).
Les vraies données (`data/db.json`) ne sont pas touchées.

## Mise en ligne sur Vercel (recommandé)

Le site complet (pages, réservation, comptes, factures, assistant, espace chauffeur, QR code) tourne sur Vercel. Vercel n'ayant pas de disque permanent, les données sont enregistrées dans une base **Postgres Neon** (offre gratuite, ajoutée en deux clics depuis Vercel).

1. Mettre ce dossier dans un dépôt GitHub (tout le projet, sans `node_modules` ni `.env`).
2. Sur vercel.com : **Add New → Project**, choisir le dépôt, puis **Deploy** sans rien changer (la configuration est dans `vercel.json`).
3. Dans le projet Vercel : **Storage → Create Database → Neon (Postgres)**, puis **Connect** au projet. Vercel ajoute tout seul la variable `DATABASE_URL`.
4. **Settings → Environment Variables** : ajouter au minimum
   - `SITE_URL` = l'adresse du site (ex. `https://taxi-saint-irenee.vercel.app`, puis votre nom de domaine),
   - `DRIVER_PASSWORD` = le mot de passe de l'espace chauffeur,
   - `SECURE_COOKIES` = `1`,
   - et selon vos besoins `NTFY_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `ANTHROPIC_API_KEY`, `COMPANY_*` (voir le tableau ci-dessous).
5. **Deployments → Redeploy** pour prendre en compte les variables. C'est en ligne.
6. Nom de domaine : **Settings → Domains → Add**, puis suivre les indications DNS de Vercel. Mettre ensuite `SITE_URL` à jour.

QR code : imprimez-le **après** avoir réglé `SITE_URL` sur l'adresse définitive (ou fixez-la avec `QR_BASE_URL`). L'adresse `…vercel.app` reste active même avec un nom de domaine : un QR code imprimé avec elle continue de fonctionner.

Une copie de sauvegarde quotidienne des données est gardée 30 jours dans la base. Neon permet aussi de restaurer la base à une date passée.

## Mise en ligne sur un autre hébergeur Node.js

L'ancien site était une simple vitrine hébergée sur GitHub Pages. Celui-ci a des comptes clients, des factures, un espace chauffeur et des notifications : il a besoin d'un **hébergeur Node.js** (GitHub Pages ne peut pas le faire tourner). Il n'y a pas de base de données à installer : tout est enregistré dans `data/db.json`. Conviennent : Render, Railway, Fly.io, un VPS, ou « Setup Node.js App » de cPanel / o2switch.

- Commande d'installation : `npm install` · commande de démarrage : `npm start`
- Le dossier `data/` doit être **persistant** (disque permanent). Une copie de sauvegarde est faite chaque jour dans `data/backups/` (30 jours gardés) ; copiez aussi ce dossier ailleurs de temps en temps.
- Définir les variables de `.env.example` dans l'interface de l'hébergeur, notamment `SITE_URL` (adresse publique du site), `SECURE_COOKIES=1` et `DRIVER_PASSWORD`.
- Les fichiers (styles, scripts, images) sont servis avec une empreinte de version : après une mise à jour, les visiteurs reçoivent automatiquement les nouveaux fichiers.

## À configurer

| Variable | Rôle |
|---|---|
| `SITE_URL` | Adresse publique du site (liens des e-mails, plan du site, QR code). |
| `DRIVER_PASSWORD` | Accès à `/chauffeur`. Obligatoire. |
| `CONTACT_EMAIL` | Adresse affichée sur le site (par défaut taxisaintirenee@gmail.com). |
| `NTFY_URL` | Notification instantanée des nouvelles demandes sur le téléphone du chauffeur : installer l'application gratuite **ntfy**, s'abonner au même sujet que dans l'URL. |
| `RESEND_API_KEY`, `MAIL_FROM`, `DRIVER_EMAIL` | E-mails : demande reçue (en français ou en anglais selon le client), course confirmée, facture, mot de passe oublié (compte gratuit sur resend.com, avec le nom de domaine du site). |
| `GOOGLE_REVIEW_URL` | Lien « Laisser un avis » (fiche Google). Sans lui, le bouton ouvre un e-mail. |
| `ANTHROPIC_API_KEY` | Assistant rédigé par Claude. Facultatif. Modèle réglable avec `ASSISTANT_MODEL`. |
| `COMPANY_*` | Mentions légales et pied des factures : forme juridique, adresse, SIRET, TVA, numéro ADS, conventionnement CPAM, médiateur de la consommation, hébergeur. `COMPANY_DIRECTOR` et `COMPANY_OWNER` : le nom n'apparaît que sur les mentions légales et les factures, et seulement s'il est renseigné (le site dit partout « le chauffeur »). |
| `VAT_RATE` | TVA transport de voyageurs, 10 % par défaut ; `0` si franchise en base (la mention art. 293 B s'affiche alors). |
| `LOYALTY_STEP`, `LOYALTY_REWARD` | Règle de fidélité. |
| `QR_BASE_URL` | Facultatif : impose l'adresse imprimée dans le QR code. |

**À compléter avant la mise en ligne** : les champs `[à compléter]` de `/mentions-legales` (variables `COMPANY_*`). Relire aussi les textes des pages : ils décrivent le service tel que présenté dans la charte et l'ancien site, à ajuster si un détail ne correspond pas.

## Avis clients et photos du véhicule

- **Avis** : uniquement de vrais avis, à ajouter dans `content/reviews.json` (mode d'emploi dans `content/LISEZMOI.md`). Tant que la liste est vide, la section invite à laisser un avis.
- **Photos du véhicule** : déposer `exterieur.jpg`, `interieur.jpg` et/ou `coffre.jpg` dans `public/assets/img/vehicule/`. Elles s'affichent automatiquement sous la section « À bord » de l'accueil ; sans photo, rien ne s'affiche (aucune image de remplacement, aucun dessin).

## Organisation du code

```
server/        serveur HTTP, API, comptes, analyse des habitudes, assistant, notifications, QR code
views/         pages françaises, en/ pages anglaises, partials/ (en-tête, pied de page, formulaire de réservation)
content/       avis clients
public/        styles, scripts, polices, logos, icônes, service worker
test/          tests automatiques (npm test)
data/          base de données JSON et sauvegardes (créées au premier lancement)
```

Pour modifier un texte, éditer le fichier de `views/` correspondant (et sa version dans `views/en/`). Les textes communs (en-tête, pied de page, formulaire de réservation) sont dans `server/i18n.js` et `public/assets/js/i18n.js`.

## Sécurité et données

- Mots de passe chiffrés (scrypt), session par cookie `HttpOnly`, protection contre les requêtes d'autres sites, limites de tentatives sur la connexion et les formulaires, piège anti-robots sur les formulaires.
- Politique de sécurité du contenu stricte : aucun script ni style externe, police Jost hébergée sur le site.
- Autocomplétion des adresses et distance indicative par la Géoplateforme IGN (service public, sans clé).
- L'espace client, l'espace chauffeur et les factures ne sont jamais conservés hors connexion sur l'appareil.
- Le client peut supprimer son compte ; ses factures sont conservées dix ans, comme l'exige la loi.
