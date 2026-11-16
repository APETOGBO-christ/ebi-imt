# Mémo des décisions techniques à coût — EBI-IMT Business Manager

**Motif** : conformité à la règle 15 (« Signale immédiatement les décisions techniques qui entraînent des coûts supplémentaires »). Ce mémo rattrape la latence constatée le 16/11/2026 : toute décision future à coût sera **annoncée en séance au moment de la décision**, puis consignée ici dans le même commit que le changement.

## 1. Décisions à coût déjà encourues ou engagées

| Décision | Date | Coût | État | Justification |
|---|---|---|---|---|
| Création d'un projet Supabase neuf sur le **plan gratuit** | 13/11/2026 | 0 € direct, **mais** : base en veille après 7 jours d'inactivité (restauration nécessaire), 500 Mo de base, emailing Auth limité | Encouru (neutre tant que pas d'usage quotidien) | Test complet et développement gratuits |
| **Cloudflare R2** (stock documentaire) | 13/11/2026 | 0 € jusqu'à ~10 Go de stockage ; **egress gratuit** (atout de R2) ; au-delà ~15 $/To/mois | Encouru (usage réel quasi nul : ~2 Mo) | Fichiers privés sans frais de sortie |
| **Cloudflare Pages** (hébergement front) | 2026-11 | 0 € au régime standard (500 builds/mois) | Encouru | Déploiement continu gratuit |
| **Docker Desktop requis pour pgTAP** (94+39 tests) | 12/11/2026 | 0 € ; coût en **temps** (machine à allumer) | Bloqué (Docker resté éteint) | Tests de verrouillage complets |
| Sauvegardes quotidiennes vers OneDrive/archives | 16/11/2026 | 0 € ; consomme l'espace de stockage existant | Engagé (procédure écrite) | Durabilité des données |

## 2. Décisions à coût à venir — à décider par le commanditaire

| Décision | Coût estimé | Échéance conseillée | Conséquence si refusé |
|---|---|---|---|
| **Passer Supabase au plan Pro** | ~25 $/mois | Avant le premier usage quotidien réel | Base en veille après 7 jours sans connexion (l'application deviendra indisponible jusqu'à restauration manuelle) ; quota emailing réduit |
| **Achat d'un nom de domaine** (ex. `gestion.ebi-imt.tg`) | ~10-15 $/an | Au déploiement Pages | L'application reste sur `*.pages.dev` (URL fixe mais moins professionnelle) |
| **SMTP personnalisé** (ex. Resend, Zoho) pour les invitations/réinitialisations | 0-10 $/mois | Si invitations fréquentes | Les e-mails d'invitation passent par le SMTP limité de Supabase (risque de quota) |
| **Second bucket R2 / réplication** pour la redondance du stock documentaire | ~15 $/To/mois selon volume | Optionnel (les sauvegardes SQL + purge R2 peuvent suffire au départ) | En cas d'incident R2 : pertes de fichiers possibles jusqu'à la dernière copie |
| **Renouvellement/rotation des clés R2** | 0 € ; temps exploit (~15 min/an) | Tous les 12 mois | Risque sécurité si ignoré |

## 3. Décisions sans coût que l'on a examinées
- **MFA** : natif Supabase, gratuit ; seul coût = possession d'un téléphone par l'administrateur.
- **Journalisation des connexions (M33)** : implémentée en base, aucune facturation.
- **Hébergement des fonctions Edge** : facturé au nombre d'appels ; volume attendu (≤ 3 utilisateurs) très en dessous des quotas gratuits.

## 4. Engagement de travail (à partir de ce jour)
1. **Annonce immédiate** : toute proposition de changement entraînant un coût (abonnement, achat, quota, temps d'exploitation récurrent) est signalée **dans le message qui propose le changement**, avec estimation et alternative gratuite si elle existe.
2. **Trace durable** : la décision est ajoutée au tableau § 1 ou § 2 de ce mémo dans le même commit.
3. **Revue** : ce mémo est relu à chaque bilan de phase (mise en production, changements de plan, incidents).
