# Checklist Phase 0 — Validation et fondations

Checklist opérationnelle de la Phase 0, établie le 12 novembre 2026. Elle concrétise les 7 critères de sortie de `docs/architecture-ebi-imt.md` § 10. **La Phase 0 n'est close que si chaque item est coché avec une preuve archivée** (sortie de commande, capture d'écran, fichier de résultat). Aucun item ne peut être coché « sur la foi du code ».

Règles permanentes :
- Aucune migration sur l'ancien projet Cortexia (`docs/security-review.md` § 4 : garde-fous de link).
- Aucune donnée métier fictive — les jeux d'essai de la Phase 0 sont des **données de recette** créées uniquement en local/préproduction, marquées comme telles, et détruites avant la mise en service.
- Un test n'est « réussi » qu'avec sa preuve d'exécution.

## V0 — Prérequis externes (direction)

| # | Item | Responsable | Preuve |
| --- | --- | --- | --- |
| V0.1 | Compte GitHub EBI-IMT créé + dépôt vierge ; nom communiqué (D9) | Direction | URL du dépôt |
| V0.2 | Projet Supabase neuf créé (région, PG 17) ; URL + clé publishable transmises | Direction | URL projet |
| V0.3 | Compte Cloudflare créé (R2 + Pages) | Direction | Accès console |
| V0.4 | Deux disques externes disponibles (dont un conservé hors bureau) | Direction | Invéntaire matériel |
| V0.5 | Domaine e-mail réel communiqué (identifiants, SMTP, D3 : préfixes officiels) | Direction | Document de cadrage |
| V0.6 | Docker Desktop fonctionnel sur la machine de développement | Dev | `docker version` OK |
| V0.7 | Décisions D1-D9 de `docs/audit-final.md` § 8 validées ou arbitrées | Direction | Compte rendu |

## V1 — Revue et validation du schéma définitif (critère 1)

| # | Item | Détail |
| --- | --- | --- |
| V1.1 | Relire `docs/database-schema.md` (42 tables, RLS, RPC) et confronter à l'Annexe A de l'architecture v2 | Écart = 0 |
| V1.2 | Revue de lecture des 15 migrations ligne à ligne (assistant + relecteur distinct) | Compte rendu par migration |
| V1.3 | Définition écrite des tables **nouvelles** Phase 1+ (rôles, permissions, sociétés, documents polymorphes, appels d'offres, projets, achats, livraisons, facturation, numérotation) présentée à la direction — en SQL rédigé, **non appliqué** | Document + validation |
| V1.4 | Corrections S5 (préfixes) et D2 (inscription) intégrées aux fichiers de migration ou en migration 16, selon § 4 de `docs/migration-plan.md` | Diff archivé |

## V2 — Matrice des rôles et permissions (critère 2)

| # | Item | Détail |
| --- | --- | --- |
| V2.1 | Tableau 6 rôles × ~23 modules × 5 actions (consult/créer/modifier/valider/supprimer) rédigé, cohérent avec l'existant (délégations `finance_verifiers`, `field_budget_permissions`) | Document validé par la direction |
| V2.2 | Cas limites arbitrés : validation financière (qui ?), appels d'offres (validation direction), vision DG transversale, périmètre `sales_manager`/commercial (D5) | Décisions consignées |
| V2.3 | Traduction en SQL prévue (table `roles` + `role_permissions` + `permits()`) sans application | Script en attente |

## V3 — Migrations vérifiées (critère 3) — local Docker

| # | Item | Commande | Attendu | Preuve |
| --- | --- | --- | --- | --- |
| V3.1 | Démarrage local | `supabase start` | Stack saine | Sortie |
| V3.2 | Application complète | `supabase db reset` | 15 migrations, 0 erreur | Sortie |
| V3.3 | Comptage des objets | SQL : tables=42, enums=16, séquences=5, buckets=4 | Exact | Sortie |
| V3.4 | Grants anon | `select … has_schema_privilege/…` : anon sans privilège sur public.* et storage | Vide | Sortie |
| V3.5 | RLS actif partout | `relrowsecurity = true` pour les 42 tables | 42/42 | Sortie |
| V3.6 | Seed de référence uniquement (`supabase/seed.sql` : 3 lignes de référence fictives locales, marquées comme telles) | `supabase db reset` | Conforme | Sortie |

## V4 — Tests RLS multi-rôles (critère 4)

| # | Item | Détail |
| --- | --- | --- |
| V4.1 | `supabase test db` : 31/31 assertions pgTAP existantes | Preuve de sortie |
| V4.2 | Écrire les tests **comportementaux** : pour chaque rôle actuel (admin/sales_manager/sales_rep + sessions sans profil) — lecture attribuée réussie, lecture hors périmètre refusée (0 ligne), écriture directe refusée là où RPC obligatoire (leads, orders, payments, documents, imports…), RPC hors rôle refusée, utilisateur inactif sans accès (porte restrictive) | Fichier pgTAP + 100 % passant |
| V4.3 | Scénarios de bout en bout manuels en local (2 comptes de recette) : prospect → proposition → PDF → commande → paiement → reçu → commission ; avance terrain → dépenses → restitution → clôture | Captures + constats |
| V4.4 | Test d'échec contrôlé : tentative d'UPDATE `profiles.role` direct, d'insertion paiement confirmé direct, de suppression ledger | Refus constatés (triggers/RLS) |

## V5 — Configuration sécurisée de R2 (critère 5)

| # | Item | Détail |
| --- | --- | --- |
| V5.1 | Bucket R2 créé (nom validé), privé, aucune URL publique | Console CF |
| V5.2 | Clé d'API R2 à périmètre restreint (bucket unique, permissions minimales) ; secrets Edge configurés (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) | Console + `supabase secrets list` |
| V5.3 | CORS R2 restreint au domaine Pages (méthodes GET/PUT, origine exacte) | Console |
| V5.4 | Test de refus : requête non signée refusée ; PUT hors TTL refusé | Preuves |

## V6 — Test réel d'upload / téléchargement (critère 6)

| # | Item | Détail |
| --- | --- | --- |
| V6.1 | Flux complet via l'application : émission d'URL pré-signée → upload → enregistrement métier → hash SHA-256 vérifié → journal d'accès alimenté | Comptes de recette |
| V6.2 | Orphelin simulé : upload R2 réussi + enregistrement PG volontairement échoué → détection par le staging/la réconciliation | Preuve |
| V6.3 | Téléchargement : URL signée TTL court, accès refusé sans autorisation, entrée de trace visible | Preuves |
| V6.4 | PDF officiel de recette généré par Edge (proposition + reçu) sur la préproduction, avec hash enregistré | Fichiers + preuves |

## V7 — Première sauvegarde + test de restauration (critère 7)

| # | Item | Détail |
| --- | --- | --- |
| V7.1 | Script de sauvegarde écrit et journalisé : `pg_dump` chiffré (age/gpg) + export tables de métadonnées + `rclone`/export des fichiers | Script dans le dépôt (sans secrets) |
| V7.2 | Première exécution réelle : archive PG + archive fichiers | Horodatage, tailles, sommes de contrôle |
| V7.3 | Copie sur les **deux disques** (A bureau, B hors bureau) | Journal |
| V7.4 | Restauration locale vérifiée : base restaurée (Docker) + contrôle 42 tables + fichier restauré et hash identique | Preuve |
| V7.5 | Runbook de sauvegarde/restauration versionné dans `docs/` | Document |
| V7.6 | Planification quotidienne (tâche planifiée) + keep-alif Supabase (visite planifiée) | Planification en place |

## V8 — Clôture de Phase 0

| # | Item |
| --- | --- |
| V8.1 | Revue complète de la checklist avec la direction : GO/NO-GO écrit pour la Phase 1 |
| V8.2 | Mise à jour de `docs/audit-final.md` (statuts des anomalies S1-S16, D1-D9) |
| V8.3 | Nettoyage des données de recette locales ; préproduction prête |
| V8.4 | Commit de la Phase 0 sur le nouveau dépôt GitHub ; `origin` mis à jour ; dist/ et .env non versionnés (vérifié) |

## Rappels d'exécution (environnement Windows)

Les shims `npm run …` sont inopérants à cause du `&` dans le chemin du projet. Utiliser les binaires directement :

```powershell
node node_modules\typescript\bin\tsc -b --pretty false
node node_modules\vitest\vitest.mjs run
node node_modules\vite\bin\vite.js build
```

Références croisées : procédure distante = `docs/migration-plan.md` ; anomalies = `docs/security-review.md` ; schéma = `docs/database-schema.md`.
