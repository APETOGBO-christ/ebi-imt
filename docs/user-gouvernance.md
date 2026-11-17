# Gouvernance — utilisateurs, journal d'activité et paramètres (Prompt 5)

## Utilisateurs (Paramètres → onglet Utilisateurs)

Écran réservé aux habilitations `parametres`/`utilisateurs`. Il permet à l'administrateur autorisé de :

- **Inviter un collaborateur** : e-mail + nom + rôle (six rôles v2). La fonction Edge `invite-user` vérifie l'identité, le second facteur (MFA) et le rôle admin, puis GoTrue envoie l'invitation ; un audit `admin_user_invited` est enregistré.
- **Consulter les utilisateurs** : nom, téléphone, rôle, statut d'accès, statut MFA, dernière activité.
- **Attribuer un rôle** : menu déroulant par ligne (`set_profile_role`, contrôlé serveur, audit `role_change`).
- **Modifier les permissions** : onglet Permissions, matrice `role_permissions` par rôle et module (voir `docs/roles-permissions-matrix.md`).
- **Activer ou désactiver un compte** : `admin_set_profile_active` ; un compte désactivé est verrouillé par la porte restrictive `active_profile_gate` sur toutes les tables.
- **Révoquer les accès** : bouton Révoquer (`invite-user` / `revoke_sessions`) : désactive le profil + bloque le compte côté Auth (les nouvelles connexions et rafraîchissements sont refusés).
- **Dernière activité** : dernière connexion (`auth_login` du journal) et dernière connexion Auth.
- **Statut MFA** : interrogé en direct auprès de GoTrue (nombre de facteurs, vérification). Bouton **Réinitialiser MFA** pour supprimer les facteurs d'un utilisateur qui les a perdus.
- **Réinitialiser un accès (procédure sécurisée)** : l'utilisateur utilise « Mot de passe oublié ? » sur la page de connexion (lien de récupération envoyé par e-mail, expire rapidement). **Aucun secret, mot de passe, jeton ou lien n'est jamais affiché dans l'interface.**

## Journal d'activité (Paramètres → onglet Journal)

Journal centralisé **append-only** (`audit_logs` : seule la lecture est permise aux rôles de lecture transversale ; INSERT/UPDATE/DELETE refusés — écritures uniquement via fonctions SECURITY DEFINER). Filtres : entité, action, recherche. Consultable par la direction et l'administration.

Événements tracés : connexions/déconnexions (`auth_login`, `auth_logout`), sociétés, contacts, échanges, prospects, appels d'offres, commandes, livraisons, factures, projets, activités, montants et validations financières (`payment_events` et journal `commercial_order_events`), documents (création, corbeille, restauration ; téléchargements dans `document_access_logs`), rôles et permissions (`role_change`, `crm_audit_role_permissions`), actions administratives (`admin_user_*`), paramètres généraux et catégories (`app_settings`, `library_categories`).

Chaque événement comporte : utilisateur (acteur), action, entité, identifiant, date et heure, métadonnées (ancien/nouveau). Aucun secret ni mot de passe n'est journalisé (les fonctions d'audit excluent les champs sensibles et les actions Auth n'enregistrent que `login`/`logout` sur liste blanche).

## Paramètres généraux (Paramètres → onglet Général)

Table `app_settings` (singleton). L'administrateur peut y régler :

- Informations officielles : raison sociale, nom commercial, adresse, ville, téléphone, e-mail, site web, logo (URL).
- Préférences d'affichage : scène 3D du tableau de bord ; gestion des modules visibles dans la navigation (aucun coché = tous actifs).
- Devise : **FCFA (XOF)**, verrouillée par l'architecture.
- Numérotation : consultée dans l'onglet Numérotation (émise automatiquement par le système, modifiable seulement en base).
- Catégories documentaires : table `library_categories` (code + libellé), utilisée par la bibliothèque.
- Paramètres de conservation : durée de conservation des documents et du journal (années).
- Paramètres financiers : TVA par défaut, pénalité de retard.

Toute modification des paramètres et des catégories est journalisée (trigger d'audit, ancien/nouveau). La lecture des paramètres suit la lecture transversale (admin, direction) ; l'écriture est réservée à l'administrateur.

## Vue direction (/direction)

Page dédiée à la direction (et à l'administration) : indicateurs transversaux de tous les modules (sociétés, prospects, appels d'offres, commandes, encaissements vérifiés, paiements à valider, documents actifs) et derniers événements du journal. **Lecture seule** : la matrice ne donne à la direction aucun droit d'insertion/modification automatique, hormis les validations explicitement accordées (achats, appels d'offres, commandes, facturation).

## Opérations courantes sans PostgreSQL

Toutes les opérations de gouvernance (inviter, rôles, permissions, activer/désactiver, révoquer, MFA, paramètres, catégories) sont réalisables depuis l'interface. PostgreSQL n'est nécessaire que pour la numérotation officielle et la maintenance décrites dans `docs/procedures-exploitation.md`.
