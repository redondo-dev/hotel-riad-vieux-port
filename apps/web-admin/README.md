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

**Comptes de démonstration :** avec `DEMO_MODE=true`, `npm run db:seed:demo` crée un compte
par rôle (voir `apps/api/README.md`). Ils ne sont jamais affichés sur la page de connexion.

**E-mails :** les liens « mot de passe oublié » et « invitation » sont écrits dans le dossier
`outbox/` à la racine ; ouvrez le fichier et collez le lien dans le navigateur.

## Contenu actuel

| Écran                                                         | Accès                        |
| ------------------------------------------------------------- | ---------------------------- |
| Connexion, mot de passe oublié                                | Sans session                 |
| Choisir un mot de passe (lien e-mail)                         | Sans session                 |
| Accueil (provisoire)                                          | Tous les rôles               |
| Mon compte : informations, mot de passe                       | Tous les rôles               |
| Réservations : liste, recherche, fiche                        | Direction, réception         |
| Réservations : nouvelle réservation (téléphone, comptoir)     | Direction, réception         |
| Réservations : modifier, attribuer une chambre, annuler       | Direction, réception         |
| Non remboursable : modifier, annuler ; renoncer aux frais     | Direction                    |
| Ménage : état des chambres par étage ; propre ou à nettoyer   | Direction, ménage            |
| Ménage : signaler une chambre à nettoyer                      | Direction, réception, ménage |
| Pannes : liste, fiche, signaler, commenter                    | Tous les rôles               |
| Pannes : démarrer, marquer résolue                            | Direction, technique         |
| Pannes : clôturer, rouvrir                                    | Direction                    |
| Pannes : assigner (technicien, prestataire)                   | Direction, réception         |
| Catalogue : catégories, chambres, tarifs, services (lecture)  | Direction, réception         |
| Catalogue : modifier catégories, chambres, périodes, services | Direction                    |
| Catalogue : fermer ou rouvrir une catégorie à la vente        | Direction, réception         |
| Utilisateurs : inviter, modifier, désactiver, envoyer un lien | Direction                    |

Le menu n'affiche que les rubriques autorisées au rôle ; l'API vérifie les mêmes droits. Les
rubriques du quotidien (planning, arrivées et départs, tableau de bord) seront ajoutées avec
leurs modules. Le rôle ménage arrive directement sur l'écran Ménage et le rôle technique sur
les Pannes, tous deux pensés d'abord pour le téléphone.

Dans le catalogue, les prix se saisissent en euros (« 95 » ou « 95,50 ») et les périodes par
leur première et leur dernière nuit, incluses. Rien ne se supprime sauf les périodes de tarif et
les fermetures de vente : une catégorie, une chambre ou un service se désactive.

Une réservation se modifie en deux temps : « Voir le nouveau prix » (rien n'est enregistré),
puis « Enregistrer ». Si un collègue l'a modifiée entre-temps, la fenêtre l'indique (son nom
et l'heure), garde la saisie et propose « Recharger ». Le sélecteur de chambre ne propose que
les chambres de la catégorie libres et en service sur tout le séjour, avec leur propreté.

Une nouvelle réservation (téléphone ou comptoir) se prend sur une seule page en trois blocs :
le séjour (dates, puis pour chaque chambre les adultes, les âges des enfants « 6, 3 » et le lit
bébé), le client (trouvé par son nom ou son e-mail, ou nouveau), puis le récapitulatif
(origine, prestations, notes, total). « Voir les disponibilités » affiche pour chaque chambre
les catégories avec leur prix ; une catégorie fermée, trop petite ou complète est grisée avec
sa raison. Tout changement du séjour demande de relancer la recherche. Le formulaire envoie
une clé d'idempotence : un double clic ne crée pas deux réservations.

Les écrans se répondent : sur l'écran Ménage, la clé à molette d'une case ouvre « Signaler une
panne » avec la chambre déjà choisie (`/pannes?chambre=<id>`) ; dans l'onglet Chambres du
catalogue, le badge « Hors service » marque une chambre retirée de la vente aujourd'hui par une
panne. Il disparaît seul quand la panne est résolue.

## Sécurité côté navigateur

- Session dans un cookie `HttpOnly` illisible par le code ; seul le jeton anti-CSRF est gardé
  en mémoire et envoyé dans `X-CSRF-Token` sur chaque modification.
- Session expirée ou compte désactivé (401) : retour à la connexion, puis à la page en cours.
- Retour après connexion limité aux adresses de l'outil (pas de redirection vers un autre site).
- Le jeton des liens e-mail est retiré de la barre d'adresse dès l'ouverture de la page.

## Tests

`npm run test --workspace=@riad/web-admin` : règles des rôles, du menu, du retour après
connexion, des mots de passe, des garde-fous de la gestion des comptes, et lecture des montants,
pourcentages et dates du catalogue, droits et regroupement par étage du ménage, actions
autorisées et textes des pannes.
