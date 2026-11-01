# API — Hôtel Riad Vieux-Port

État : **module 2, socle du serveur HTTP**. La base de données (module 1) et la couche HTTP
commune sont en place ; seul le contrôle de santé `GET /api/v1/health` est exposé. Aucune route
métier n'existe encore.

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

### Tests

`npm run test` (depuis `apps/api` ou la racine) lance les tests unitaires et d'intégration. Les
tests qui ont besoin de PostgreSQL utilisent **uniquement** `TEST_DATABASE_URL`, une base dédiée
dont le nom doit contenir « test » ; sans cette variable, ils sont affichés comme ignorés.

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
| `npm run db:seed:demo` | Charge l'hôtel fictif et 4 comptes de démonstration (exige `DEMO_MODE=true`) |
| `npm run db:test:sql`  | Vérifie migrations et contraintes sur une base **jetable** (voir ci-dessous) |

Chaque commande affiche la base ciblée (sans mot de passe) avant d'agir.

### Données de démonstration

Hôtel fictif uniquement. `DEMO_MODE=true` et `DEMO_USER_PASSWORD` (12 caractères minimum)
sont obligatoires ; aucun mot de passe n'est écrit dans le code. Comptes créés :
`direction@`, `reception@`, `menage@` et `technique@riad-vieux-port.example`.

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
