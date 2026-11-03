# API — Hôtel Riad Vieux-Port

État : **module 9, réception et tableau de bord (en cours)**. La base de données (module 1), la
couche HTTP commune (module 2) et l'identité du personnel (module 3) sont en place, ainsi que la
lecture publique du catalogue (`/api/v1/public`) et sa gestion par le personnel
(`/api/v1/admin/catalog`), l'état du ménage des chambres (`/api/v1/admin/housekeeping`), le
suivi des pannes (`/api/v1/admin/incidents`), les disponibilités du personnel
(`/api/v1/admin/availability`), les réservations du personnel (`/api/v1/admin/reservations`),
le planning des chambres (`/api/v1/admin/planning`) et la réception (`/api/v1/admin/front-desk`).

## Serveur HTTP

```bash
npm run dev:api     # depuis la racine : http://localhost:3000, redémarre à chaque modification
npm run start:api   # sans redémarrage automatique
```

Vérification : http://localhost:3000/api/v1/health doit répondre `{"status":"ok"}`.

| Élément    | Règle                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| Adresses   | Toutes sous `/api/v1` ; contrat dans `openapi/openapi.yaml`                                                     |
| Erreurs    | Format RFC 9457 (`application/problem+json`), jamais de détail interne au client                                |
| Suivi      | En-tête `X-Trace-Id` sur chaque réponse, repris dans les erreurs et le journal                                  |
| Journal    | Pino, une ligne JSON par événement ; mots de passe, jetons et cookies masqués, e-mails réduits à `j***@domaine` |
| Validation | Zod sur le corps, les paramètres et la requête, avant tout code métier (`validated`)                            |
| Sécurité   | Helmet ; CORS limité à `API_ALLOWED_ORIGINS` ; corps JSON de 100 Ko maximum                                     |
| Limitation | 300 requêtes par minute et par adresse IP sur toute l'API ; limites plus strictes par route à venir             |
| Arrêt      | À la demande de l'hébergeur, fin des requêtes en cours (10 s maximum) puis fermeture de la base                 |

Organisation (dossier d'architecture, section 7) : `src/app.ts` assemble l'application,
`src/main.ts` la démarre, `src/shared/http` contient les éléments communs à toutes les routes,
`src/shared/domain/errors.ts` les erreurs métier. Les modules métier ajouteront leurs routes
dans `src/modules/<module>/http`.

## Catalogue public (`/api/v1/public`)

Trois routes en lecture seule, sans session, pour le site public : `GET /hotel`,
`GET /room-categories` et `GET /services` (détail dans `openapi/openapi.yaml`).

| Sujet         | Règle                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Contenu       | Rien d'interne : ni identifiant technique, ni numéro de chambre, ni taux de TVA                                         |
| Catégories    | Seules les catégories actives ayant au moins une chambre active ; textes en français et en anglais                      |
| Prix « dès »  | Nuit la moins chère réservable en ligne à partir d'aujourd'hui (saisons et événements compris), tarif non remboursable  |
| Tarifs        | Un événement l'emporte sur une saison ; une période propre à la catégorie l'emporte sur une période commune             |
| Services      | Seules les options actives réservables en ligne (petit-déjeuner, lit bébé…) ; les atouts de l'hôtel restent sur le site |
| Cache         | `Cache-Control: public, max-age=300` : un changement de prix apparaît sur le site en 5 minutes au plus                  |
| Non configuré | Sans paramètres de l'hôtel, réponse 503 `HOTEL_NOT_CONFIGURED`                                                          |

Le calcul du prix d'une nuit (`src/modules/catalog/domain/pricing.ts`) servira aussi aux devis
de réservation : une seule règle de tarif pour tout l'hôtel. Les jours sont comptés à l'heure
de Marseille (`Europe/Paris`).

## Gestion du catalogue (`/api/v1/admin/catalog`)

Catégories, chambres, saisons et événements, fermetures de vente et services (détail dans
`openapi/openapi.yaml`). Session du personnel et jeton anti-CSRF obligatoires.

| Sujet       | Règle                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Droits      | Direction : tout ; réception : lecture et fermetures de vente ; ménage et technique : aucun accès                 |
| Suppression | Jamais pour une catégorie, une chambre ou un service (désactivation) ; possible pour une période ou une fermeture |
| Séjours     | Désactivation refusée tant que des séjours à venir l'occupent : `ROOM_HAS_STAYS`, `CATEGORY_HAS_STAYS`            |
| Code        | Le code d'une catégorie ou d'un service ne change jamais : il figure dans les adresses du site                    |
| Langues     | Nom, description et lits obligatoires en français et en anglais                                                   |
| Nuits       | Données par la première et la dernière nuit, incluses ; une période dure au plus 1 100 nuits                      |
| Conflits    | Numéro de chambre déjà pris : 409 `ROOM_NUMBER_TAKEN` ; périodes en chevauchement : 409 `RATE_PERIOD_OVERLAP`     |
| Hors vente  | `outOfService` vrai si un blocage non levé couvre aujourd'hui (panne « inutilisable », maintenance)               |
| Prix        | Un changement ne touche que les futures réservations : chaque réservation garde le prix de ses nuits              |
| Journal     | Chaque modification est inscrite dans `audit_logs` (qui, quoi, avant → après), dans la même transaction           |

## Ménage (`/api/v1/admin/housekeeping`)

`GET /rooms` (filtres `floor` et `status`), `PATCH /rooms/:id` et `POST /rooms/status` ; détail
dans `openapi/openapi.yaml`.

| Sujet   | Règle                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------- |
| États   | Deux seulement : propre (`clean`) ou à nettoyer (`dirty`) ; seules les chambres actives sont concernées |
| Droits  | Ménage et direction : les deux états ; réception : « à nettoyer » seulement ; technique : aucun accès   |
| Groupé  | Plusieurs chambres d'un coup, tout ou rien ; `changed` compte celles qui ont vraiment changé            |
| Journal | Chaque changement réel est inscrit dans `audit_logs` (`room.housekeeping_changed`, avant → après)       |
| À venir | Passage automatique en « à nettoyer » au départ d'un client, avec le module Réservations                |

## Pannes (`/api/v1/admin/incidents`)

Liste, fiche avec historique, signalement, changement d'état, assignation et commentaires ;
détail dans `openapi/openapi.yaml`.

| Sujet        | Règle                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Signaler     | Tous les rôles ; une chambre ou un lieu ; référence automatique `INC-000001`                      |
| Inutilisable | « Chambre inutilisable » la retire de la vente aussitôt ; elle revient à la vente à la résolution |
| États        | Signalée → en cours → résolue → clôturée ; la direction peut rouvrir une panne résolue            |
| Droits       | Technique : en cours et résolue ; direction : tout, dont clôturer ; réception : assigner          |
| Assigner     | À un technicien actif et/ou à un prestataire externe nommé en texte (direction, réception)        |
| Historique   | Chaque état, assignation et commentaire est daté dans `incident_events`, et inscrit au journal    |
| Séjours      | La fiche liste les séjours attribués à la chambre pendant le blocage (`affectedStays`)            |
| À venir      | Photos (stockage de fichiers), e-mails pour les urgences (Brevo)                                  |

## Disponibilités (`/api/v1/admin/availability`)

Disponibilités et prix d'un séjour pour la saisie au comptoir ou au téléphone ; détail dans
`openapi/openapi.yaml`. Exemple : `?checkIn=2026-05-12&checkOut=2026-05-15&guests=2-6_3`.

| Sujet          | Règle                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Droits         | Direction et réception ; ménage et technique : aucun accès                                                 |
| Limites        | Arrivée ni passée (RM-04) ni à plus de 730 jours ; 90 nuits au plus ; pas les limites en ligne (RM-06)     |
| Chambres       | Par nuit : chambres actives non bloquées − chambres réservées (RM-02) ; un blocage levé ne compte pas      |
| Fermeture      | Une fermeture à la vente est signalée (`closed`), la catégorie reste affichée                              |
| Prix           | Base ± saison ou événement, plus suppléments (RM-10) ; non remboursable = flexible − remise, nuit par nuit |
| Suppléments    | Les places incluses vont d'abord aux adultes et aux 12 ans et plus ; bébé (0-1 an) gratuit et non compté   |
| Taxe           | Taxe de séjour à part : par adulte et par nuit, au taux des paramètres (RM-13, à confirmer)                |
| Rien de retenu | La réservation (étape suivante) revérifie la disponibilité dans sa transaction (RM-03)                     |

## Réservations (`/api/v1/admin/reservations`)

Saisie par le personnel, liste et détail ; détail dans `openapi/openapi.yaml`.

| Sujet            | Règle                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Droits           | Direction et réception ; ménage et technique : aucun accès                                                    |
| Création         | Téléphone ou comptoir ; statut « confirmée », paiement « non payé », sans garantie (Stripe plus tard)         |
| Dernière chambre | Catégories verrouillées, puis disponibilité recomptée nuit par nuit : une seule réservation l'obtient (RM-03) |
| Refus            | Trop de voyageurs (sonde P1) ; catégorie fermée à la vente : 409 `CATEGORY_CLOSED` ; 409 `NOT_AVAILABLE`      |
| Prix figés       | Prix de chaque nuit enregistré avec la réservation (RM-14) ; un changement de tarif ne le modifie pas         |
| Prestations      | Sur tout le séjour : petit-déjeuner par personne et par nuit, bébé exclu (RM-12) ; prix figé                  |
| Taxe             | Ligne séparée : par adulte et par nuit, au taux des paramètres ; absente si le taux vaut 0 (RM-13)            |
| Annulation       | Tarif flexible : gratuite jusqu'à 48 h avant 15 h le jour d'arrivée (RM-15) ; non remboursable : aucune       |
| Double clic      | En-tête `Idempotency-Key` obligatoire : la même clé renvoie la même réponse, sans 2e réservation              |
| Client           | Existant (`customerId`) ou nouveau (`newCustomer`) ; recherche : `GET /customers?q=` (10 résultats)           |
| Liste            | Arrivées à partir d'aujourd'hui par défaut ; recherche, filtres, 25 par page ; archivées exclues              |
| Journal          | `reservation.created` dans `audit_logs`, dans la même transaction                                             |

### Modifier, annuler, attribuer une chambre

| Sujet            | Règle                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Version          | `PATCH` exige `If-Match` (version lue) : 428 sans lui, 412 si un collègue a modifié entre-temps (son nom et l'heure) |
| Modifier         | Dates et voyageurs : réservation confirmée ; tout le séjour recalculé aux tarifs du jour ; `?preview=true` : aperçu  |
| Recompté         | Prestations par personne ou par nuit et taxe de séjour suivent le nouveau séjour ; leur prix unitaire reste figé     |
| Non remboursable | Modifier ou annuler : direction seule, motif obligatoire (RM-18) ; 403 `MANAGEMENT_ONLY`                             |
| Annuler          | Avant l'arrivée ; flexible : gratuit jusqu'à l'échéance puis 1re nuit (RM-15) ; non remboursable : nuits dues        |
| Frais            | Enregistrés à encaisser (`cancellationFeeCents`) ; la direction peut y renoncer ; chambres libérées aussitôt         |
| Chambre          | Même catégorie seulement ; refus : désactivée (P3), hors service (P4), déjà attribuée (aussi refusé par la base)     |
| Sélecteur        | `GET …/rooms/{lineId}/free-rooms` : chambres libres et en service sur tout le séjour, avec leur propreté             |
| Dates            | Nouvelles dates refusées si la chambre attribuée n'y est pas libre : 409 `ROOM_NOT_FREE`, changer de chambre d'abord |
| Journal          | `reservation.updated`, `reservation.cancelled`, `reservation.room_assigned`, dans la même transaction                |

### Planning des chambres

| Sujet    | Règle                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Adresse  | `GET /api/v1/admin/planning?from=…&to=…` : deux jours inclus, 31 jours au plus                               |
| Contenu  | Par catégorie : chambres (numéro, étage, propreté), séjours placés, blocages en cours, ligne « À attribuer » |
| Exclus   | Réservations annulées, expirées ou non présentées ; chambres désactivées sans séjour ; blocages levés        |
| Droits   | Tous les rôles, en lecture ; nom du client (« Martin J. ») pour la direction et la réception seulement       |
| Rapidité | Quatre requêtes quelle que soit la taille de l'hôtel ; un mois entier en moins d'1 s (testé)                 |

### Arrivées et départs

| Sujet        | Règle                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Adresse      | `GET /api/v1/admin/front-desk?date=…` (aujourd'hui par défaut) : arrivées et départs, à faire d'abord      |
| Retards      | Arrivée passée sans arrivée (`late`) et client resté après son départ : listés, hors compteurs             |
| Arrivée      | `POST …/check-in` : confirmée, du jour d'arrivée à la veille du départ ; chambres attribuées et en service |
| Propreté     | Chambre à nettoyer : 409 `ROOM_DIRTY`, sauf `acceptDirtyRoom: true`, inscrit au journal                    |
| Départ       | `POST …/check-out` : le jour du départ ou après ; chambres « à nettoyer » ; pas encore de départ anticipé  |
| Non présenté | `POST …/no-show` : dès le lendemain de l'arrivée ; 1re nuit (flexible) ou toutes (RM-17) à encaisser       |
| Version      | Les trois actions exigent `If-Match` (428, 412), comme la modification                                     |
| Droits       | Direction et réception ; journal `reservation.checked_in`, `checked_out`, `no_show`                        |

## Comptes du personnel (`/api/v1/admin`)

Routes détaillées dans `openapi/openapi.yaml`. Règles appliquées :

| Sujet            | Règle                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Mot de passe     | 12 caractères minimum, haché avec Argon2id ; jamais choisi par la direction pour quelqu'un d'autre                                             |
| Connexion        | Même réponse quelle que soit la cause d'échec ; blocage 15 min après 5 échecs ; 10 échecs / 15 min par IP et par compte                        |
| Session          | Côté serveur (table `user_sessions`) ; cookie `riad.sid` HttpOnly, SameSite=Strict, Secure en production ; nouvelle session à chaque connexion |
| Durée            | Déconnexion après 30 min d'inactivité et 12 h au maximum                                                                                       |
| CSRF             | En-tête `X-CSRF-Token` (jeton reçu à la connexion) exigé sur toute requête qui modifie des données                                             |
| Liens par e-mail | Usage unique, seule l'empreinte SHA-256 est stockée ; 30 min (oubli) ou 48 h (nouveau compte)                                                  |
| Comptes          | Direction uniquement ; pas de suppression (désactivation) ; jamais sans compte de direction actif                                              |
| Effet immédiat   | Désactivation, changement de rôle ou de mot de passe : les sessions concernées sont fermées                                                    |
| Journal          | Connexions, échecs, blocages, mots de passe et gestion des comptes inscrits dans `audit_logs`                                                  |

**E-mails en développement :** aucun e-mail n'est envoyé. Chaque message est écrit dans le
dossier `outbox/` à la racine du dépôt (ignoré par Git) : ouvrez le fichier pour suivre le lien.
Le service d'envoi réel (Brevo) sera branché à la phase 6 ; d'ici là, l'API refuse de démarrer
en production.

**Premier compte :** `npm run db:seed:demo` (portfolio, `DEMO_MODE=true`) crée un compte par
rôle, dont `direction@riad-vieux-port.example`, avec le mot de passe `DEMO_USER_PASSWORD`.

### Tests

`npm run test` (depuis `apps/api` ou la racine) lance les tests unitaires et d'intégration. Les
tests qui ont besoin de PostgreSQL utilisent **uniquement** `TEST_DATABASE_URL`, une base dédiée
dont le nom doit contenir « test » et différente de `DATABASE_URL` ; sans cette variable, ils
sont affichés comme ignorés. Avant chaque lancement, le schéma de cette base est reconstruit par
les migrations (annulation complète puis réapplication) : **ses données sont effacées**.

## Base de données

Le schéma (27 tables) est défini **uniquement** par les migrations SQL de `db/migrations`,
exécutées par [Umzug](https://github.com/sequelize/umzug), l'outil de migration de Sequelize.
Sequelize sert à lire et écrire les données, jamais à créer ou modifier les tables
(`sequelize.sync()` est proscrit).

| Migration                | Contenu                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `0001_foundations`       | Extensions `btree_gist` et `citext`, fonctions utilitaires                      |
| `0002_identity`          | Personnel, réinitialisation des mots de passe, sessions, paramètres de l'hôtel  |
| `0003_catalog`           | Catégories, photos, chambres, saisons et événements, fermetures, prestations    |
| `0004_reservations`      | Clients, réservations, chambres réservées, prix par nuit, prestations du séjour |
| `0005_billing`           | Paiements, numérotation, factures et avoirs, lignes de facture                  |
| `0006_maintenance`       | Pannes, photos, historique, mises hors service                                  |
| `0007_technical`         | Journal des actions sensibles, messages de contact, idempotence, webhooks       |
| `0008_invoice_numbering` | Numéro de facture attribué par la base elle-même (audit QA-01)                  |

### Garanties assurées par la base elle-même

- **Une chambre ne peut pas être attribuée deux fois sur des nuits qui se chevauchent**
  (contrainte d'exclusion), même avec deux demandes simultanées. Un départ et une arrivée le
  même jour sont autorisés.
- Les dates et l'état « actif » des chambres réservées sont recopiés automatiquement de la
  réservation : ils ne peuvent pas diverger. Une annulation libère la chambre.
- Les factures sont numérotées sans trou **par la base elle-même** : l'application insère une
  facture sans numéro (en fournir un est refusé) et reçoit le suivant de la série (`FA` facture,
  `AV` avoir) pour l'année d'émission, heure de Paris. Une facture émise, ses lignes, un paiement réussi
  et une prestation facturée ne sont ni modifiables ni supprimables.
- Le journal des actions sensibles est en ajout seul ; seules les entrées de plus d'un an
  peuvent être purgées.
- `TRUNCATE` est interdit sur les tables protégées.

Ces règles de facturation reprennent RM-21 : **elles restent à confirmer par un
expert-comptable** avant toute utilisation réelle.

### Contrôles confiés à l'API

La base n'empêche pas les cas suivants : l'API doit les refuser, et **chacun doit avoir son
test automatisé** dans le module qui l'implémente (audit QA, sondes P1 à P9).

| Sonde | Cas à refuser                                                            | Module      |
| ----- | ------------------------------------------------------------------------ | ----------- |
| P1    | Plus de personnes que la capacité de la catégorie                        | Réservation |
| P3    | Attribution d'une chambre désactivée                                     | Réservation |
| P4    | Attribution d'une chambre hors service sur les nuits concernées          | Réservation |
| P6    | Remboursement rattaché au paiement d'une autre réservation               | Paiements   |
| P7    | Remboursements cumulés supérieurs au paiement (`REFUND_EXCEEDS_PAYMENT`) | Paiements   |
| P8    | Avoir d'une réservation corrigeant la facture d'une autre réservation    | Facturation |
| P9    | Facture dont la somme des lignes diffère du total                        | Facturation |

Le module API devra aussi ajouter les en-têtes de sécurité et la liste des hôtes autorisés au
serveur de rendu du site public, et vérifier que l'API importe correctement `packages/shared`.

## Commandes

À lancer depuis la racine du dépôt. Les variables sont lues dans le fichier `.env` racine.

| Commande               | Effet                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| `npm run db:status`    | Liste les migrations appliquées et en attente                                |
| `npm run db:migrate`   | Applique les migrations en attente                                           |
| `npm run db:rollback`  | Annule la dernière migration (**refusé en production**)                      |
| `npm run db:seed:demo` | Charge l'hôtel fictif, 4 comptes et ~40 séjours (exige `DEMO_MODE=true`)     |
| `npm run db:test:sql`  | Vérifie migrations et contraintes sur une base **jetable** (voir ci-dessous) |

Chaque commande affiche la base ciblée (sans mot de passe) avant d'agir.

### Données de démonstration

Hôtel fictif uniquement. `DEMO_MODE=true` et `DEMO_USER_PASSWORD` (12 caractères minimum)
sont obligatoires ; aucun mot de passe n'est écrit dans le code. Comptes créés :
`direction@`, `reception@`, `menage@` et `technique@riad-vieux-port.example`.

La commande ajoute aussi une quarantaine de séjours autour du jour où elle est lancée (de 7 jours
avant à 30 jours après) : partis, présents, arrivées du jour, à venir, quelques-uns sans
chambre et deux annulés. Clients fictifs en `@example.com`. Les séjours passent par les mêmes
règles que l'outil de gestion (prix réels du catalogue, nuits, prestations, journal). Ils ne
se chargent qu'une fois : si un client de démonstration existe déjà, rien n'est ajouté, et
aucune autre réservation n'est modifiée ni supprimée.

### Vérification de la base

`npm run db:test:sql` utilise `psql` et les variables de connexion PostgreSQL standard
(`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`). Il crée une base temporaire
`riad_sqltest_<n>`, puis applique les migrations, charge deux fois les données, exécute les
tests de `db/tests`, lance un test de concurrence à deux sessions, annule toutes les
migrations et les réapplique. La base temporaire est toujours supprimée à la fin ; aucune
autre base n'est touchée. Le compte utilisé doit pouvoir créer des bases.

## Prérequis

- Node.js 22.18 ou plus récent (exécution directe du TypeScript, sans compilation).
- PostgreSQL 16 ou plus récent, avec les extensions `btree_gist` et `citext`.
