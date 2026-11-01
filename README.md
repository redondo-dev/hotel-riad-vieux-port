# Hôtel Riad Vieux-Port

Site de réservation et outil de gestion d'un hôtel indépendant de 85 chambres à Marseille.
Projet portfolio : l'hôtel, ses tarifs et ses avis sont fictifs.

## Contenu du dépôt

Un seul dépôt réunit toutes les parties du projet (espaces de travail npm) :

| Dossier           | Rôle                                  | Technologie                              |
| ----------------- | ------------------------------------- | ---------------------------------------- |
| `apps/api`        | API REST et tâches de fond            | Node.js, Express, TypeScript, PostgreSQL |
| `apps/web-public` | Site public et réservation en ligne   | Angular (rendu côté serveur)             |
| `apps/web-admin`  | Outil de gestion interne              | Angular                                  |
| `packages/shared` | Types et règles de validation communs | TypeScript, Zod                          |
| `docs`            | Documentation du dépôt                | Markdown                                 |

> État : le site public affiche la page d'accueil et la recherche de séjour, alimentées par
> des **données fictives**. Aucun serveur n'est encore branché : rien n'est réservé ni enregistré.

## Prérequis

- **Node.js 24** (version indiquée dans `.nvmrc`) ; minimum accepté : 22.18 (exécution directe du TypeScript par l'API).
  Avec nvm : `nvm use`.
- **npm 10** ou plus récent.
- **Git**.

## Installation

```bash
git clone https://github.com/redondo-dev/hotel-riad-vieux-port.git
cd hotel-riad-vieux-port
npm install
```

`npm install` installe les dépendances de toutes les parties et active les contrôles
automatiques avant chaque commit.

Pour le développement local, copier le modèle de variables d'environnement :

```bash
cp .env.example .env
```

Ne jamais committer `.env` : il contient des secrets.

## Commandes

À lancer depuis la racine du dépôt :

| Commande                  | Effet                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| `npm run lint`            | Détecte les erreurs dans le code (ESLint)                                    |
| `npm run lint:fix`        | Corrige automatiquement ce qui peut l'être                                   |
| `npm run format`          | Met en forme tous les fichiers (Prettier)                                    |
| `npm run format:check`    | Vérifie la mise en forme sans rien modifier                                  |
| `npm run typecheck`       | Vérifie les types TypeScript de chaque partie                                |
| `npm run test`            | Lance les tests de chaque partie                                             |
| `npm run check`           | Lint + mise en forme + types : à lancer avant d'ouvrir une demande de fusion |
| `npm run start:public`    | Lance le site public en français sur http://localhost:4200/fr/               |
| `npm run start:public:en` | Lance le site public en anglais                                              |

### Vérification complète sur un poste de développement

Ces contrôles n'ont jamais pu être lancés dans l'environnement de l'audit QA (registre npm
inaccessible). À faire une fois, puis avant chaque fusion dans `dev` :

1. `npm install` : aucune erreur ni avertissement de dépendances incompatibles
   (Angular 21, `lucide-angular`, Zod 4, Umzug 3).
2. `npm run check` : lint, mise en forme et types (dont `logger: undefined` dans
   `apps/api/db/migrate.ts`).
3. `npm run test` : tests du paquet partagé, de l'API et du site public avec Vitest.
4. `npm run build` : compilation du site public en français **et** en anglais.
5. `npm run start:public`, puis ouvrir http://localhost:4200/fr/ : vérifier l'accueil, le
   calendrier et la page 404 au clavier.
6. `npm run db:test:sql` sur une base PostgreSQL locale (voir `apps/api/README.md`).

Tout échec est à signaler avant de poursuivre.

### Site public : langues

Le site est compilé une fois par langue (internationalisation intégrée d'Angular) :
`/fr/…` et `/en/…`. Le serveur de développement n'affiche qu'une langue à la fois, d'où les
deux commandes ci-dessus. Les traductions anglaises sont dans
`apps/web-public/src/locale/messages.en.json` ; toute traduction manquante fait échouer la
compilation, pour ne jamais publier une page à moitié traduite.

## Branches et contributions

```
etape/x-y-nom  →  dev  →  main
```

- `main` : version stable, alimentée uniquement par fusion depuis `dev`.
- `dev` : branche d'intégration.
- `etape/…` : une branche par étape du plan d'implémentation, fusionnée dans `dev` après relecture.

### Messages de commit

Format [Conventional Commits](https://www.conventionalcommits.org/fr/), description en français :

```
type(portée): description courte
```

Exemples :

```
feat(api): ajoute le point de santé /health
fix(web-public): corrige le calcul du nombre de nuits
docs: complète la procédure d'installation
```

Types : `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
Portées : `api`, `web-public`, `web-admin`, `shared`, `db`, `ci`, `deps`, `docs`, `socle`.

Pas d'espace avant les deux-points : c'est la syntaxe attendue par l'outil de contrôle.
Un message mal formé est refusé au moment du commit.

## Conventions

- Code (noms de tables, classes, fonctions, variables, adresses d'API) : **anglais**.
- Messages de commit et documentation : **français**.
- TypeScript en mode strict ; aucun `console.log` (utiliser le journal applicatif).
