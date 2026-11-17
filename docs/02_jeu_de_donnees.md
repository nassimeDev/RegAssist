# 02 — Le jeu de données : recherche, choix et observations

## 1. Où trouver la réglementation bancaire marocaine ?

Les sources envisagées :

| Source | Avantages | Inconvénients |
|---|---|---|
| Pages « Réglementation » du site de Bank Al-Maghrib (circulaires par thème) | Textes officiels, un PDF par texte | Dispersées, formats hétérogènes, certains PDF scannés |
| Bulletin officiel (BO) | Fait foi juridiquement | Un BO mélange des dizaines de textes, souvent scanné, bilingue |
| **Recueil des textes législatifs et réglementaires (BAM)** | **Un seul PDF officiel, consolidé, structuré, texte natif** | Mis à jour à fin 2023 seulement |

**Choix retenu : le Recueil**, publié par Bank Al-Maghrib sur la page « Supervision bancaire → Recueil des textes législatifs et réglementaires ». L'URL exacte est dans `data/corpus.yaml`.

Pourquoi ce choix :
- **Textes consolidés** : chaque texte y figure « tel que modifié et complété ». La question délicate des versions (quelle circulaire remplace laquelle ?) est déjà traitée par BAM, à la date de mise à jour.
- **Texte natif** : pas d'OCR nécessaire, donc pas d'erreurs de reconnaissance.
- **Structure régulière** : en-têtes, parties, titres de textes et articles suivent toujours la même forme, ce qui permet un découpage fiable.
- **Un périmètre complet** : lois, décrets, arrêtés, circulaires, directives et chartes, soit environ 170 textes.

Limite assumée : les textes publiés **après fin 2023** n'y sont pas. `corpus.yaml` permet d'ajouter des circulaires isolées (profil `generic`) et de marquer un texte comme abrogé (`overrides`).

## 2. Ce que l'exploration du PDF a révélé

Avant d'écrire le moindre code de découpage, on a **inspecté le vrai document** : extraction du texte des pages, comptage des titres, lecture d'échantillons. Ces observations ont directement guidé le code.

**Volume**
- 1 268 pages, environ 3,2 millions de caractères de texte natif.
- **123 titres** de circulaires et de directives détectés en tête de page, sans compter les lois, décrets et arrêtés.

**Organisation en 11 parties**, chacune indiquée dans l'en-tête de chaque page. **C'est notre champ `theme`, obtenu gratuitement** :

| Page de début | Partie |
|---|---|
| 20 | 1. Statut de Bank Al-Maghrib |
| 42 | 2. Cadre relatif aux établissements de crédit et organismes assimilés |
| 602 | 3. Lutte contre le blanchiment des capitaux et le financement du terrorisme |
| 686 | 4. Instruments de politique monétaire et programmes de refinancement |
| 750 | 5. Taux d'intérêt |
| 766 | 6. Marchés des titres, monétaire et de change |
| 962 | 7. Relations établissements de crédit - clientèle |
| 1152 | 8. Services d'information financière |
| 1170 | 9. Inclusion financière |
| 1180 | 10. Places financières |
| 1202 | 11. Cadre relatif au financement collaboratif |

Les pages 1 à 19 (couverture, préambule, table des matières) sont ignorées par le profil `bam_recueil`.

**L'en-tête répété sur chaque page**
```
RECUEIL DES TEXTES LEGISLATIFS ET REGLEMENTAIRES REGISSANT L'ACTIVITE DES ETABLISSEMENTS DE CREDIT ET ORGANISMES ASSIMILES
Mis à jour à fin 2023 631 3. LUTTE CONTRE LE BLANCHIMENT DES CAPITAUX ET LE FINANCEMENT DU TERRORISME
PUBLIC
```
Selon l'extracteur, la deuxième ligne arrive **collée** : `Mis à jour à fin 20236313. LUTTE…`, soit 2023, puis la page 631, puis la partie 3. Le code s'appuie sur le numéro de page connu pour séparer les trois (`clean.py → _parse_bam_header_line`).

**Le début d'un texte**
```
Circulaire n°5/W/15 du 20 mai 2015 relative aux documents et
renseignements nécessaires pour l'instruction de la demande
d'agrément, telle que modifiée et complétée24
Le Wali de Bank Al-Maghrib ;
Vu la loi n° 103-12 relative aux établissements de crédit …
```
On a donc un titre sur 1 à 3 lignes, puis un **préambule type** (« Le Wali… », « Vu… »). Le `24` collé est un **appel de note de bas de page**.

**Les articles**
```
Chapitre I
Article premier228
…
Chapitre II
Article 2229
Article 3230
```
Les appels de note sont **collés aux numéros d'article** : « Article 2229 » signifie l'article 2 suivi de la note 229. C'est le piège le plus subtil du corpus (voir [04](04_chunking.md)).

## 3. Le fichier `data/corpus.yaml`

```yaml
documents:
  - id: bam_recueil_2023
    url: "https://www.bkam.ma/fr/content/download/…/Recueil…VF.pdf"
    profile: bam_recueil
    metadata:
      title: "Recueil des textes législatifs et réglementaires …"
      overrides:                      # optionnel
        "1/W/2018": { status: abroge }
```

- `profile` choisit les règles de nettoyage : `bam_recueil` ou `generic`.
- `metadata` d'un document isolé : `reference`, `doc_type`, `date`, `theme`, `status`, `replaces`.
- `overrides` (pour le recueil) : corrige le statut d'un texte précis, identifié par sa référence.

`make download` télécharge les fichiers, vérifie qu'il s'agit bien de PDF et écrit `data/raw/manifest.json` (URL, taille, SHA-256, date). On sait ainsi **exactement** quelle version du corpus a été indexée.

## 4. Les métadonnées extraites pour chaque texte

| Champ | Exemple | Comment |
|---|---|---|
| `doc_type` | circulaire | premier mot du titre |
| `reference` | 5/W/2017 | expression régulière sur le titre |
| `reference_norm` | 5/w/2017 | normalisée : « 5/W/17 » et « 5/W/2017 » sont identiques |
| `issued_on` | 2017-07-24 | date en français dans le titre (la date grégorienne est prioritaire pour les dahirs) |
| `theme` | 3. LUTTE CONTRE LE BLANCHIMENT… | en-tête de la page de début |
| `status` | en_vigueur | par défaut, ou `overrides` |
| `page_start`/`page_end` | 630 / 646 | position dans le PDF |

## 5. À faire de votre côté

1. `make download`, puis `make dry-run` : lisez la sortie. Le nombre de textes détectés est-il proche de 170 ? Les articles sont-ils bien numérotés ?
2. Notez les cas ratés : un titre non détecté, un article manqué. Ajustez les expressions régulières de `splitter.py` ou `chunker.py`, puis ajoutez un test qui reproduit le cas.
3. Gardez une trace de ces ajustements. En entretien, « voici un cas réel que mon premier découpage ratait, et comment je l'ai corrigé » est un excellent exemple.
