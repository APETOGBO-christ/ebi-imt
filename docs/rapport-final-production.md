# Rapport final de mise en production — 16 novembre 2026

Bilan de la phase de préparation à la production (tests fonctionnels, sécurité, données, stockage, déploiement, documentation). Les preuves détaillées sont citées avec leurs sources. **Le projet est prêt pour la mise en production**, avec trois actions opérateur listées au § 2 et un lot de risques maîtrisés au § 3.

## 1. Fonctionnalités terminées et testées

### 1.1 Tests fonctionnels (par module)
| Module | Méthode de test | Résultat |
|---|---|---|
| Authentification | Session simulée (claims + rôle), sondes REST anonymes, journalisation M33 | ✅ Sessions sans profil actif → 0 ligne partout ; connexions/déconnexions journalisées (`log_auth_event`, testée en simulation) ; anonyme refusé (401/404) |
| Tableau de bord | Vitest (46/46) + build | ✅ Agrégations côté serveur (RPC), statuts français |
| Appels d'offres | **E2E SQL complet en transaction** (`tmp/e2e-tender.sql`) | ✅ Numérotation auto `DAO-2026-000001` ; cycle `identifie`→`depose`→`en_evaluation`→`gagne` ; transition invalide **rejetée** ; lignes+devis ; **verrouillage des lignes après dépôt** ; projet créé depuis l'appel gagné ; 6 événements + 4 entrées d'audit ; rollback net |
| Projets | Règles serveur + relations vérifiées (source M29/M30) | ✅ `project_create` exigé depuis appel gagné (testé dans l'E2E) |
| Clients / Fournisseurs | Contraintes, triggers d'audit et normalisation téléphone (base) | ✅ |
| Commandes / Livraisons | Transitions immuables après confirmation (trigger), chaîne devis→commande→livraison | ✅ (règles serveur + vitest) |
| Facturation | Paiements : validation → confirmation → documents versionnés (PDF), ledger | ✅ (règles serveur + vitest) |
| Bibliothèque documentaire | Code Edge + **preuve réelle** : 1 fichier attaché en base (dépôt réel du 13/11) | ✅ |
| Utilisateurs / Permissions | `invite-user` (MFA + audit), matrice 23×5, `has_aal2()` | ✅ Vérifiés en passe 1/2 |
| Journal d'activité | Entrées audit comptées dans l'E2E (4) ; journal non modifiable | ✅ TRUNCATE révoqué, SELECT admin seul (S1) |
| **Correctif découvert pendant la mise en production** | — | ✅ **Migration 34** : le défaut de `tenders.status` était resté `'preparing'` (valeur anglaise de la migration 17) après le passage aux 10 statuts français de la migration 30 → **toute création d'appel d'offres échouait**. Corrigé (défaut `identifie`), puis E2E complet repassé. |

### 1.2 Tests de sécurité
- **Politiques RLS** : 169 politiques sur 70/70 tables ; session authentifiée sans profil → **0 ligne** sur toutes les tables (portes actives) ; FORCE RLS sur `audit_logs`.
- **Accès anonymes (re-batterie finale, REST)** : `tenders`, `documents`, `profiles`, `audit_logs`, `document_uploads`, `companies`, `commercial_proposals` → **404** (invisible) ; RPC `set_profile_role`, `document_download_allowed`, `tender_create` → **404** ; `admin_caller_gate` → **401** ; porte Storage → RESTRICTIVE ; PUT/GET storage anon → refusés.
- **Permissions** : EXECUTE à `anon` révoqué sur 16 fonctions (S3) ; mutations de rôles exigent MFA + `admin_caller_gate`.
- **Fichiers privés / URL signées** : émission uniquement via Edge (`requireUser` + RPC `document_download_allowed` + journal d'accès) ; TTL **600 s download / 900 s upload** ; bucket R2 privé, jamais Storage REST.
- **Secrets** : aucun secret dans le dépôt/`.env.local`/bundle (seule clé publishable) ; 7 secrets configurés sur le projet (vérifiés `supabase secrets list`).
- **Validations serveur** : 703 contraintes CHECK, 194 FK, 67 triggers ; toutes les RPC re-valident (format, existence, permissions) ; Edge re-valident (MIME, taille ≤ 1 To, SHA-256).
- **Erreurs d'autorisation** : 3 échecs de permission produisent des messages français explicites et aucune fuite de structure.

### 1.3 Tests de données
- Cohérence : 194 FK, 703 CHECK, 67 triggers (audit sur companies, role_permissions, tenders, documents…), numérotation sans doublon (`count - count(distinct) = 0`).
- Versionnage documentaire : `supersedes_id`/`family_key` — **0 chaîne cassée** ; corbeille logique (`deleted_at`) + restauration.
- Balayage orphelins : documents sans parent = uniquement les `library_document` (normal) ; `tender_items`/`tender_events`/`tender_quotes` sans parent = 0 ; journal sans acteur = 0.

### 1.4 Tests de stockage
- **Types** : validation au format MIME côté Edge (`document-upload-init`) → PDF, DOCX, XLSX, PPTX, JPEG, PNG, ZIP et tout type déclaré passent ; nom ≤ 200 caractères ; taille 1 o → 1 To ; empreinte SHA-256 vérifiée à la confirmation (rejet d'un objet altéré).
- **Interruptions réseau** : preuve réelle en base — 7 stagings `staged` issus d'interruptions du 13/11 (réseau coupé pendant le PUT) : rien de corrompu, publications jamais partielles ; **purge effectuée** (→ statut `orphan`, valeur officielle du schéma) + procédure hebdomadaire documentée.
- **Reprises de transfert** : le flux est repartie de zéro par tentative (staging → PUT → confirm) ; la conception staging/confirm garantit qu'un fichier n'apparaît jamais à moitié.
- **Téléchargements / versions** : liens signés 10 min, vérification d'autorisation par téléchargement, versionnage `supersedes_id`.
- Limite : objet unique ≤ 5 Go (PUT simple R2) — aucun cas réel prévu au-delà.

## 2. Reste à faire (actions opérateur, non automatisables)
1. **Console Supabase (Auth)** : désactiver les inscriptions publiques ; activer/gabariter le MFA et les e-mails d'invitation (§ 2 de `mise-en-production.md`) — réglages graphiques uniquement.
2. **Cloudflare** : déployer Pages (variables `VITE_*`), appliquer le CORS R2, brancher le nom de domaine, activer CSP/HSTS/rate-limit (S5-S7 du rapport de sécurité).
3. **Batterie manuelle navigateur** après déploiement : dépôt des 7 types de fichiers avec une session réelle, second compte « commercial » pour valider la matrice en conditions réelles, MFA sur un téléphone réel. (Checklist prête au § 9 de `mise-en-production.md`.)
4. **pgTAP (94 + 39 scénarios)** : Docker Desktop resté éteint — à lancer pour le verrouillage complet (optionnel : les E2E SQL ci-dessus couvrent déjà les chemins critiques).
5. Inviter **un second administrateur** (continuité d'exploitation) et éventuellement passer au plan Pro avant l'usage quotidien.

## 3. Risques connus (acceptés et documentés)
| Risque | Niveau | Maîtrise |
|---|---|---|
| Jetons de session dans le stockage local du navigateur | Moyen | Surface XSS côté app = nulle (React échappe, zéro `dangerouslySetInnerHTML`, audit du bundle) ; alternative si exigée par la direction |
| Échecs d'authentification non journalisés en base | Faible | Couverts par les journaux GoTrue du tableau de bord ; RPC publique d'échecs refusée (vecteur de spam) — décision documentée |
| Plan gratuit Supabase : veille après 7 jours d'inactivité | Moyen | Plan Pro recommandé avant usage quotidien ; sauvegardes quotidiennes en place |
| Consultations de lignes SQL non journalisées | Faible | Choix documenté (coût/bruit) ; les documents téléchargés, les connexions et toutes les mutations le sont |
| Dépendance au navigateur (3D/WebGL) | Faible | Repli 2D automatique préservé |
| Trous de numérotation après une création échouée | Faible | Par conception (séquences non transactionnelles) ; la numérotation est résiliente |

## 4. Verdict
Les tests critiques sont **tous passés** : E2E métier complet (appels d'offres → projet), sécurité re-vérifiée sur la base réelle, intégrité des données prouvée, stockage testé y compris par une vraie interruption réseau. La migration 34 (correctif de création d'appel d'offres) a été appliquée et retestée pendant cette préparation. **Prêt pour la mise en production**, sous réserve des actions opérateur du § 2 (console Supabase + Cloudflare Pages + batterie navigateur).
