# EBI-IMT Business Manager

Système d'information centralisé d'EBI-IMT : appels d'offres, projets, clients, partenaires, fournisseurs, commandes et achats, livraisons, facturation, bibliothèque documentaire, utilisateurs, journal d'activité et paramètres.

Socle repris d'un projet antérieur (Cortexia Base) dont le design et les modules commerciaux/financiers sont conservés ; l'adaptation à EBI-IMT est décrite dans [docs/architecture-ebi-imt.md](docs/architecture-ebi-imt.md).

## Architecture

- `auth.users` est la source d'identité ; `public.profiles` porte le rôle métier.
- `companies`, `contacts` et `leads` conservent l'historique commercial.
- `activities`, `offer_templates`, `orders`, `payments`, `documents`, `expenses`, `commissions` et `production_projects` modélisent le parcours opérationnel.
- `import_batches` et `import_rows` préparent les simulations/importations Excel et CSV sans écrasement aveugle.
- `audit_logs` est append-only côté API et protégé par RLS ; c'est aussi la chronologie générique de toute entité.
- Les documents et imports sont dans des buckets Storage privés (`ebi-documents`, `ebi-imports`, `ebi-payment-proofs`, `ebi-field-proofs`) ; la migration vers Cloudflare R2 est prévue en phase 1.

## Application frontend

```powershell
npm ci
Copy-Item .env.example .env.local
# Renseigner VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY dans .env.local
npm run dev
```

La clé publiée dans `VITE_SUPABASE_PUBLISHABLE_KEY` doit être la clé publique du projet. La clé secrète et la clé `service_role` ne doivent jamais être placées dans un fichier `VITE_*`.

L'interface contient la connexion Supabase, les routes protégées, les KPI soumis à RLS, six zones isométriques sélectionnables, un panneau contextuel et une navigation 2D. La vue 2D est proposée par défaut sur petit écran et utilisée si WebGL n'est pas disponible.

Les modules Prospects, Commerciaux, Activités, Imports, Offres, Propositions, Commandes, Paiements, Dépenses, Commissions et Rapports sont raccordés aux données Supabase. Les parcours sont décrits dans [docs/finance.md](docs/finance.md) et [docs/field-finance.md](docs/field-finance.md). Les modules Appels d'offres, Projets, Achats, Livraisons, Facturation, Bibliothèque documentaire, Utilisateurs et Journal d'activité sont décrits dans [docs/architecture-ebi-imt.md](docs/architecture-ebi-imt.md). Il n'y a pas de données simulées dans le frontend.

## Mise en production et exploitation

- [docs/mise-en-production.md](docs/mise-en-production.md) : déploiement (Supabase, Pages, R2, domaine) et checklist de vérification.
- [docs/procedures-exploitation.md](docs/procedures-exploitation.md) : sauvegarde, restauration, mise à jour, entretien hebdomadaire, incidents connus.
- [docs/rapport-final-production.md](docs/rapport-final-production.md) : bilan des tests, actions opérateur restantes, risques connus.
- [docs/security-audit.md](docs/security-audit.md) : revue de sécurité (deux passes) et durcissement (migrations 32-33).

## Base locale

Prérequis : Docker Desktop et Supabase CLI 2.108+.

```powershell
supabase start
supabase db reset
supabase test db
supabase gen types typescript --local > src/types/database.ts
```

`supabase db reset` charge uniquement les données de référence fictives présentes dans `supabase/seed.sql`. Elles ne représentent pas des données opérationnelles.

## Connexion à un projet distant

1. Créer ou sélectionner le projet dans Supabase.
2. Exécuter `supabase login`, puis `supabase link --project-ref <ref>`.
3. Vérifier le schéma cible et faire une sauvegarde.
4. Exécuter `supabase db push` après revue des migrations.
5. Configurer les clés dans l'environnement d'exécution ; la clé `service_role` reste exclusivement côté serveur/Edge Function.

L'ancien projet Cortexia est abandonné : aucune migration ne doit y être poussée. Le projet EBI-IMT est neuf ; l'ensemble des migrations s'y applique depuis zéro.

Le premier administrateur doit être créé après un utilisateur Supabase Auth, via une opération SQL de bootstrap contrôlée. Les rôles ne sont pas attribués automatiquement par le frontend.

## Autorisations

- `admin` : gouvernance complète et validation financière.
- `sales_manager` : supervision commerciale et importations supervisées ; validation financière uniquement après délégation explicite de l'administrateur.
- `sales_rep` : propres prospects attribués, activités correspondantes, commandes de son portefeuille et dépenses personnelles.
- La matrice de rôles sera étendue à la structure EBI-IMT (direction, achats, finance, lecture seule) en phase 1, avec tests RLS.
- La confirmation d'un paiement passe par `public.finance_confirm_payment(...)` avec contrôle de rôle et vérification externe déclarée.
- Les paiements et commissions sont protégés contre les mises à jour/suppressions directes ; les corrections utilisent des écritures traçables.

## Vérifications

```powershell
npm run typecheck
npm test
npm run build
```

La scène 3D est chargée séparément du shell applicatif. Le bundle 3D reste volumineux ; mesurer son temps de chargement sur les appareils cibles.
