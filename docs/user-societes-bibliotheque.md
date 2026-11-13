# Prompt 4, Phase 1 — Référentiel sociétés et bibliothèque documentaire

## État

Deux nouveaux modules remplacent les entrées « à venir » du menu : **Sociétés** (référentiel unifié clients/fournisseurs/partenaires, mode bento fiches) et **Bibliothèque** (documents de l'entreprise sur Cloudflare R2, versions et corbeille). La recherche globale du tableau de bord interroge désormais les modules, les sociétés et les documents, avec liens directs vers les fiches.

Le présent dépôt **n'est pas connecté à un projet Supabase distant** : les migrations 26-27, les six fonctions Edge documentaires et le bucket R2 `r2-library` ne sont ni appliqués ni déployés ici.

## Référentiel sociétés

- La liste présente des fiches bento (nom légal, nom commercial, ville, rôles, contacts actifs) avec filtres par rôle et recherche par nom, email ou téléphone. Les fiches inactives n'apparaissent que via le filtre dédié.
- La création passe par la RPC `company_create` (insertion directe révoquée) : nom légal obligatoire, téléphone normalisé contre les doublons, RCCM, identifiant fiscal, pays par défaut TG. L'édition met à jour la fiche ; l'audit `crm_audit_companies` trace les modifications.
- La fiche détaille quatre onglets : informations, contacts (ajout/édition, contact principal), activités (`company_activity_add`, horodatées, auteur tracé) et documents liés (`document_links`).
- La visibilité suit la matrice M16 : les quatre rôles opérationnels voient le référentiel ; la création/modification exige `permits('clients'|'fournisseurs'|'partenaires', 'insert'/'update')` (achats : fournisseurs ; finance : fournisseurs ; admin/direction : tout).

## Bibliothèque documentaire

- L'upload est en deux temps : le navigateur calcule le SHA-256 du fichier, une fonction Edge presigne l'URL R2 (zone `r2-library`, chemin `library/<famille>/<uuid>-<fichier-slug>`), puis la confirmation vérifie la taille côté R2 et le hash côté serveur avant de créer le document et son lien éventuel vers une société ou un contact.
- La vérification SHA-256 serveur est plafonnée par l'entourage `R2_VERIFY_MAX_BYTES` (50 Mio par défaut) : au-delà, la confirmation contrôle la taille uniquement et retient le hash déclaré par le navigateur ; c'est un choix documenté, pas une vérification cryptographique complète.
- Les aperçus utilisent une URL signée de 600 s : images affichées en ligne, PDF et autres types dans un lecteur intégré. Chaque accès (upload, téléchargement) est journalisé dans `document_access_logs`.
- Les versions d'un même document forment une famille (`family_key`) : remplacer un document crée une nouvelle version liée à la précédente (`supersedes_id`) et la fiche liste l'historique de la famille.
- La corbeille est logique : `document_request_delete` (motif obligatoire) pose `deleted_at/by/reason`, la restauration repasse par `document_request_restore`. Les deux exigent le module bibliothèque selon la matrice M16 ; la lecture (`select`) est ouverte à tous les rôles opérationnels.
- L'administrateur peut lancer une réconciliation R2 ↔ base (`r2-reconcile`, session MFA aal2) : l'outil compare le stock à `document_reconciliation` (manquants, orphelins, divergence de hash, staging périmé de plus de 24 h) par lots de 50 objets.

## Contrôles et limites

- Les fonctions Edge (`document-upload-init/confirm`, `document-download-url`, `document-delete`, `document-restore`, `r2-reconcile`) exigent un jeton utilisateur ; la réconciliation exige en plus un aal2. Les écritures directes en base restent révoquées à tous les rôles.
- Aucun antivirus ni scan de contenu n'est branché : ne déposer que des documents de confiance ; les types acceptés sont restreints à une liste de MIME documentaire.
- La corbeille est visuelle uniquement tant qu'aucune purge planifiée n'existe ; supprimer définitivement relève d'une opération future.
- La recherche globale et les menus s'appuient sur `role_permissions` : un utilisateur sans profil actif ne voit aucun module.

## Vérifications réalisées dans ce dépôt

`node node_modules\typescript\bin\tsc -b --pretty false`, 46/46 tests Vitest (dont SigV4 officiel AWS/R2, sociétés et bibliothèque) et `node node_modules\vite\bin\vite.js build`. La validation SQL/pgTAP (`supabase\tests\pgm4_phase1.sql`, 39 assertions) attend Docker ; le déploiement des migrations, des fonctions Edge et le parcours R2 bout en bout restent à exécuter après validation humaine.
