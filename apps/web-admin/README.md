# Outil de gestion — Hôtel Riad Vieux-Port

Application Angular interne du personnel (spécification UI/UX, section 5). Français uniquement,
sans rendu côté serveur, jamais référencée par les moteurs de recherche.

## Lancer en local

L'API doit tourner (`npm run dev:api`, avec `SESSION_SECRET` dans `.env`), puis :

```bash
npm run start:admin   # http://localhost:4300
```

En développement, le serveur Angular relaie `/api` vers l'API (`proxy.conf.json`) : navigateur,
outil et API forment un seul site, le cookie de session circule sans réglage particulier.

**Comptes de démonstration :** avec `DEMO_MODE=true` et `npm run db:seed:demo`, la page de
connexion liste les 4 comptes (un par rôle) et leur mot de passe. Hors démonstration, rien n'est
affiché.

**E-mails :** les liens « mot de passe oublié » et « invitation » sont écrits dans le dossier
`outbox/` à la racine ; ouvrez le fichier et collez le lien dans le navigateur.

## Contenu actuel

| Écran                                                         | Accès          |
| ------------------------------------------------------------- | -------------- |
| Connexion, mot de passe oublié                                | Sans session   |
| Choisir un mot de passe (lien e-mail)                         | Sans session   |
| Accueil (provisoire)                                          | Tous les rôles |
| Mon compte : informations, mot de passe                       | Tous les rôles |
| Utilisateurs : inviter, modifier, désactiver, envoyer un lien | Direction      |

Le menu n'affiche que les rubriques autorisées au rôle ; l'API vérifie les mêmes droits. Les
rubriques du quotidien (planning, arrivées et départs, ménage, pannes, tableau de bord) seront
ajoutées avec leurs modules.

## Sécurité côté navigateur

- Session dans un cookie `HttpOnly` illisible par le code ; seul le jeton anti-CSRF est gardé
  en mémoire et envoyé dans `X-CSRF-Token` sur chaque modification.
- Session expirée ou compte désactivé (401) : retour à la connexion, puis à la page en cours.
- Retour après connexion limité aux adresses de l'outil (pas de redirection vers un autre site).
- Le jeton des liens e-mail est retiré de la barre d'adresse dès l'ouverture de la page.

## Tests

`npm run test --workspace=@riad/web-admin` : règles des rôles, du menu, du retour après
connexion, des mots de passe et des garde-fous de la gestion des comptes.
