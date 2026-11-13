# Modèle de sécurité — EBI-IMT (PROMPT 3)

Architecture de sécurité complète : authentification, autorisation, MFA,
journalisation et garde-fous d'administration. Livrée en migrations SQL,
fonctions Edge et tests pgTAP — **rien n'est appliqué** tant que la
validation complète n'est pas donnée (contrainte permanente du chantier).

## 1. Principes

1. **Défense en profondeur** : six couches indépendantes (§ 4). Chaque couche
   suppose les précédentes compromises.
2. **Zéro confiance côté client** : aucune décision d'accès ne dépend du
   frontend ; React ne fait qu'afficher ce que la base autorise.
3. **Moindre privilège par défaut** : `anon` n'a aucun droit sur les tables
   métier ; `authenticated` reçoit le SELECT nécessaire et les écritures
   sensibles sont révoquées au niveau des privilèges, pas seulement en RLS.
4. **Tout est journalisé** : `public.audit_logs` (socle M9) + triggers
   `crm_audit_row` sur chaque table des extensions.

## 2. Authentification

### 2.1 Inscriptions publiques désactivées (décision D2)
- `private.ebi_signup_ready()` (redéfinie en M25) renvoie `false` : le
  frontend abandonne proprement le formulaire d'inscription
  (`src/App.tsx:95-96` affiche le refus prévu).
- L'inscription « self-service » n'existe plus ; le seul chemin d'accès est
  l'**invitation par un administrateur** via l'Edge function `invite-user`.
- Le trigger de profil en attente (`private.create_pending_profile_for_auth_user`,
  M15/M16) reste actif : tout utilisateur créé côté Auth (invitation) reçoit
  automatiquement un profil **inactif** `sales_rep` — filet de sécurité du
  flux d'invitation, pas une réouverture des inscriptions.
- M25 garantit la faisabilité de ce flux : `supabase_auth_admin` reçoit
  USAGE sur le schéma `private` et EXECUTE sur la fonction du trigger
  (le `revoke … from public` de M15 l'avait privé d'exécution).

### 2.2 Invitation et cycle de vie (`supabase/functions/invite-user/index.ts`)
Fonction Edge unique, actions mutuellement exclusives, **toutes** précédées
du même contrôle : identité vérifiée par `auth.getUser` (jeton signé),
claim `aal` = `aal2` (MFA), puis `admin_caller_gate()` (admin actif, côté
base). L'appelant doit être un administrateur enrôlé TOTP.

| Action | Effet |
|---|---|
| `invite` | `inviteUserByEmail` + `admin_bootstrap_profile` (rôle parmi les 6 actifs, nom complet) + audit. Le courriel GoTrue part avec l'URL de redirection `INVITE_REDIRECT_URL`. |
| `activate` | Lever le blocage Auth (`ban_duration 'none'`) + `admin_set_profile_active(true)` + audit. |
| `deactivate` | `admin_set_profile_active(false)` : profil désactivé, **toutes** les politiques RLS le coupent immédiatement. |
| `revoke_sessions` | Blocage Auth 876 000 h (10 ans) : nouvelles connexions et rafraîchissements refusés. Les jetons d'accès déjà émis restent techniquement valides ≤ 1 h, mais la porte restrictive `active_profile_gate` leur retire tout accès aux données dès la désactivation. |
| `reactivate` | Déblocage Auth puis `activate`. |
| `recover` | `generateLink(type:'recovery')` : le lien signé est **retourné à l'administrateur** (pas d'envoi direct), qui le transmet. |
| `reset_mfa` | Liste puis suppression de tous les facteurs MFA de l'utilisateur (cas : téléphone perdu, enrôlement à refaire). |

Rôles invitables : les 6 codes actifs de `public.roles` ; les codes
dépréciés `sales_manager`/`sales_rep` sont refusés.

### 2.3 MFA (TOTP, aal2)
- Helper `private.has_aal2()` (M25) lit le claim `aal` du JWT.
- **Obligatoire pour `admin` et `direction`** : opérations sensibles exigent
  aal2 — changement de rôle (`set_profile_role`), modification/insertion de
  la matrice `role_permissions`, confirmation d'encaissement
  (`finance_confirm_payment`), approbation/exécution d'ajustements
  (`finance_approve_adjustment`/`finance_execute_adjustment`), et toute
  action de l'Edge function.
- L'enrôlement TOTP lui-même (écran QR + vérification du premier code) est
  une tâche UI de Phase 4 ; le modèle de base est prêt (GoTrue
  `auth.mfa_*`).

### 2.4 Comptes
- **Désactivation** réversible (`deactivate`/`activate`) — conserve les
  données et les FK (aucune suppression de `profiles`).
- **Suppression d'utilisateur Auth** : non exposée dans `invite-user` ;
  sur un socle sans RGPD strict, elle reste une opération manuelle
  exceptionnelle (postgres), le profil ayant d'abord été désactivé.
- **Récupération** : liens signés générés par l'admin (`recover`).

## 3. Autorisation : rôles et permissions

- Rôles stockés en table (`public.roles`, M16), colonne `profiles.role` en
  text + FK. Matrice granulaire : voir
  `docs/roles-permissions-matrix.md` (défaut de référence V2.1, à confirmer
  par la direction).
- Résolution : `private.permits(module, action)` (M16, EXECUTE accordé à
  `authenticated`), qui lit le rôle **actif** de l'appelant puis la matrice ;
  `admin` bypass. Helper `private.current_role_code()` pour les politiques
  « rôle = X ».

## 4. Les six couches de contrôle serveur

1. **Privilèges PostgreSQL.** `anon` : rien (revoke M16-M24). `authenticated`
   : SELECT des tables lisibles ; INSERT/UPDATE/DELETE **révoqués** sur
   `roles`, `official_sequences`, documents, DAO, projets, achats,
   livraisons, factures, `role_permissions` (sauf UPDATE voulu, voir § 4.5),
   `payments`, `supplier_payments`… M25 ajoute les révokes de défense en
   profondeur à M16-M24 : les privilèges par défaut de Supabase accordent
   ALL aux rôles de service sur chaque nouvelle table ; ne pas compter sur
   la RLS seule.
2. **RLS par matrice.** Politique SELECT par table = `permits(module,'select')`.
   Les écritures directes restantes (CRM du socle) gardent leurs politiques
   propriétaires (assigned_to / can_manage_all).
3. **Porte d'activité restrictive.** `active_profile_gate` (M15), présente
   sur les 23 tables des extensions : `as restrictive` — dès que le profil
   est désactivé, **toutes** les requêtes renvoient 0 ligne, même si la
   matrice disait oui.
4. **RPC SECURITY DEFINER gardées.** Transitions métier et écritures
   sensibles uniquement via fonctions (délégations finance/terrain du
   socle, numérotation officielle M17, RPC Edge) avec contrôle de rôle
   interne + journalisation.
5. **MFA aal2 sur les opérations sensibles** (§ 2.3) + INSERT/UPDATE de la
   matrice encadrés par politique admin+aal2 (M25).
6. **Garde-fous d'administration (M25).**
   - `admin_caller_gate()` : porte consultable par l'Edge (admin actif + aal2).
   - Trigger `profiles_last_admin_guard` (BEFORE UPDATE/DELETE) : impossible
     de rétrograder, désactiver ou supprimer le **dernier administrateur
     actif** — y compris en contexte postgres.
   - `admin_set_profile_active` : refuse l'auto-désactivation, protège le
     dernier admin, journalise (`profile_activated`/`profile_deactivated`).
   - `admin_bootstrap_profile` : assignation de rôle à l'invitation
     (contexte service ou admin+MFA), refuse les rôles inconnus/dépréciés,
     journalise (`profile_role_assigned`).
   - Anti auto-élévation : `set_profile_role` reste réservé admin (aucune
     politique RLS ne permet à un utilisateur d'écrire `profiles.role`) ;
     les tests [45]-[46] le vérifient.

## 5. Cloisonnement des données et lecture transversale

- Le commercial ne voit que son portefeuille (leads assignés et leurs
  dérivés, politiques M6) ; les tests [81] le vérifient.
- **`direction` (et `admin`) lisent tout** : `can_manage_all()` — la lecture
  transversale exigée est la règle par défaut de la matrice (R partout sur
  les 20 modules métier).
- `lecture_seule` : R sur les 20 modules métier, rien sur
  utilisateurs/journal/paramètres, aucune écriture.

## 6. Journalisation

| Événement | Source |
|---|---|
| Changement de rôle (`role_change`) | `set_profile_role` |
| Rôle à l'invitation (`profile_role_assigned`) | `admin_bootstrap_profile` |
| Activation/désactivation (`profile_activated`/`profile_deactivated`) | `admin_set_profile_active` |
| Changement de matrice | trigger `crm_audit_role_permissions` (M25) |
| Création/modification de toute ligne des extensions | trigger `crm_audit_row` (M17-M24) |
| Transitions financières | événements dédiés (`invoice_events`, `supplier_payment_events`, `tender_events`) + audit socle |

## 7. Configuration et secrets

- Edge `invite-user` : `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (référencé), `INVITE_REDIRECT_URL` (optionnel,
  remplace la valeur par défaut du lien d'invitation/récupération). La clé
  `service_role` ne vit que dans les variables d'environnement Supabase,
  jamais côté client.
- Le client navigateur ne porte que la clé `publishable` (anon) ; RLS est
  l'unique barrière — d'où la couche privilèges (§ 4.1) et le revirement
  explicite des défauts Supabase.

## 8. Tests et vérification

- `supabase/tests/pgm3_security.sql` : **94 assertions pgTAP** exécutées en
  une transaction (rollback final) sur une base migrée 1-25 :
  structure (23 tables, RLS, porte), privilèges, D2, porte admin, MFA,
  protection du dernier admin, matrice (filtre et effectivité), refus
  d'écriture, profil désactivé, cloisonnement, intégrité financière
  (HT/TVA/TTC, exclusivité livraisons, lignes DAO), numérotation officielle.
- Les **6 scénarios imposés** y sont étiquetés `[SCÉNARIO n]` : écriture
  facture par un commercial (refus), suppression par `lecture_seule`
  (refus), profil désactivé (0 ligne partout), admin sans MFA (exception),
  auto-édition de la matrice (filtrée), lecture hors périmètre (0 ligne).
- Exécution : `supabase db reset` puis `psql -f supabase/tests/pgm3_security.sql`
  (voir en-tête du fichier). **En attente de Docker Desktop** — les tests
  sont écrits, pas encore exécutés.

## 9. Reste à traiter (hors base)

1. Enrôlement TOTP côté UI (Phase 4) : le modèle l'exige, l'écran reste à
   construire.
2. Confirmation V2.1 de la matrice par la direction avant démarrage.
3. `INVITE_REDIRECT_URL` à fixer au déploiement (URL Pages).
4. Exécution effective des tests pgTAP dès que Docker est disponible.
