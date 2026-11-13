# Matrice des rôles et permissions — EBI-IMT

Source de vérité : migration `supabase/migrations/20261112100016_roles_and_permissions.sql`
(M16). La matrice vit en base dans `public.role_permissions` (rôle × module × 5
actions) ; elle est **modifiable à chaud par l'administrateur** (via Edge, avec
second facteur MFA), sans nouvelle migration. Le semis ci-dessous est le
**défaut de référence V2.1, à confirmer par la direction** avant le premier
démarrage (voir `docs/model-validation-report.md`, décisions restantes).

## Rôles (`public.roles`)

| Code | Libellé | Périmètre | Statut |
|---|---|---|---|
| `admin` | Administrateur | Gouvernance complète, utilisateurs, paramètres, validation financière | Actif |
| `direction` | Direction générale | Vision transversale ; validation des appels d'offres et des engagements | Actif |
| `commercial` | Commercial | Prospects, propositions, commandes de son portefeuille, déclarations d'encaissement, dépenses terrain | Actif |
| `achats` | Achats | Fournisseurs, commandes fournisseurs, réceptions | Actif |
| `finance` | Finance | Factures, encaissements, décaissements, journal financier | Actif |
| `lecture_seule` | Consultation | Consultation générale sans écriture | Actif |
| `sales_manager` | Responsable commercial (socle hérité) | Compatibilité des littéraux du socle | Déprécié |
| `sales_rep` | Commercial terrain (socle hérité) | Compatibilité des littéraux du socle | Déprécié |

Les codes dépréciés restent valides en base (FK `profiles.role`) et gardent
leurs droits hérités, mais l'Edge function `invite-user` refuse de les
attribuer à un nouvel utilisateur.

## Légende des actions

| Lettre | Action | Colonne |
|---|---|---|
| R | Consulter (select) | `p_select` |
| I | Créer (insert) | `p_insert` |
| U | Modifier (update) | `p_update` |
| V | Valider (validate) | `p_validate` |
| D | Supprimer (delete) | `p_delete` |

## Matrice active (6 rôles × 23 modules)

| Module | admin | direction | commercial | achats | finance | lecture_seule |
|---|---|---|---|---|---|---|
| `prospects` | RIUVD | R | RIU | — | — | R |
| `activites` | RIUVD | R | RIU | — | — | R |
| `commerciaux` | RIUVD | R | R | — | — | R |
| `imports` | RIUVD | R | R | — | — | R |
| `offres` | RIUVD | R | R | — | — | R |
| `propositions` | RIUVD | R | RIU | — | — | R |
| `commandes` | RIUVD | RV | RIU | — | R | R |
| `paiements` | RIUVD | R | RIU | — | RIUV | R |
| `depenses_terrain` | RIUVD | R | RIU | — | — | R |
| `commissions` | RIUVD | R | R | — | — | R |
| `rapports` | RIUVD | R | R | R | R | R |
| `appels_offres` | RIUVD | RV | R | R | R | R |
| `projets` | RIUVD | R | R | R | R | R |
| `clients` | RIUVD | R | RIU | — | — | R |
| `partenaires` | RIUVD | R | R | R | R | R |
| `fournisseurs` | RIUVD | R | R | RIU | R | R |
| `achats` | RIUVD | RV | R | RIUV | RV | R |
| `livraisons` | RIUVD | R | R | RIU | R | R |
| `facturation` | RIUVD | RV | R | R | RIUV | R |
| `bibliotheque` | RIUVD | R | R | R | R | R |
| `utilisateurs` | RIUVD | R | — | — | — | — |
| `journal` | RIUVD | R | — | — | — | — |
| `parametres` | RIUVD | R | — | — | — | — |

Codes dépréciés (hors tableau) : `sales_rep` = commercial ; `sales_manager` =
RIU sur les 7 modules commerciaux + `commissions`, `imports`, `offres`, et V
sur `paiements`, `propositions`, `depenses_terrain`.

## Ce que la matrice ne couvre pas (par construction)

1. **Scoping par propriétaire.** La matrice dit *quel module* un rôle peut
   toucher ; les politiques RLS du socle restreignent ensuite *quelles
   lignes* (le commercial ne voit que les leads qui lui sont assignés,
   `leads_select`, migration M6). Admin et direction passent via
   `can_manage_all()`.
2. **Les écritures sensibles restent RPC.** Les tables financières et
   d'état métier (`payments`, `supplier_payments`, `invoices`, `tenders`,
   `deliveries`, `documents`…) sont en écriture directe interdite
   (privilèges révoqués à `authenticated`, migrations M18-M24) : la matrice
   commande l'accès aux RPC et aux écrans, la transition elle-même passe par
   des fonctions SECURITY DEFINER avec leurs propres contrôles de rôle
   (délégations finance/terrain du socle, MFA aal2 de M25).
3. **MFA aal2 (M25).** `set_profile_role`, modification/insertion de la
   matrice, confirmation d'encaissement et exécution d'ajustements exigent
   le second facteur, indépendamment de la matrice.
4. **Porte d'activité.** La politique restrictive `active_profile_gate`
   (M15, étendue aux 23 tables des extensions) coupe tout accès dès que le
   profil est désactivé — la matrice n'est plus lue du tout.

## Gouvernance de la matrice

- Toute modification (UPDATE ou INSERT) passe par un administrateur **avec
  MFA aal2** (politiques `role_permissions_update`/`role_permissions_insert`,
  M25) et est journalisée dans `public.audit_logs` (trigger
  `crm_audit_role_permissions`).
- L'INSERT est encadré par la même politique : un admin ne peut pas ajouter
  une ligne de matrice sans MFA.
- Un non-admin voit la matrice (nécessaire à la résolution des permissions)
  mais toute écriture est filtrée (0 ligne) ou rejetée.
