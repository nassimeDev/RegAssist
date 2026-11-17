# 04 — Découper : d'abord les textes, ensuite les articles

Fichiers : `backend/app/ingestion/splitter.py`, `backend/app/ingestion/chunker.py`

Le découpage est **l'étape qui influence le plus la qualité d'un RAG**. Un mauvais découpage ne se rattrape pas avec un meilleur LLM : si le bon passage est coupé en deux ou mélangé avec un autre, la recherche ne le trouvera pas.

## 1. Séparer le PDF en textes (`splitter.py`)

Le Recueil contient environ 170 textes dans un seul PDF. Pour citer « Circulaire 5/W/2017, article 7 », il faut d'abord savoir où chaque texte commence.

**La règle :** une ligne est un **début de texte** si :
1. elle commence par un type de texte suivi d'un numéro : `Circulaire n°…`, `Directive n°…`, `Loi n°…`, `Décret n°…`, `Arrêté du ministre… n°…`, `Lettre circulaire n°…`, `Décision réglementaire n°…` (ou `Charte de…` / `Code de…`) ;
2. **et** l'une des 12 lignes suivantes est un préambule type : `Le Wali de Bank Al-Maghrib`, `Vu…`, `Le Ministre…`, `Louange à Dieu…`, `Article premier`…

La seconde condition évite de couper sur une simple **mention** d'un texte dans le corps d'un autre (« conformément à la circulaire n° 2/G/12… »). Les lignes de table des matières (avec `....`) sont exclues.

Le résultat est une liste de `TextUnit` : titre, type, référence, date, thème, et le texte avec la **correspondance position → numéro de page** (`PagedText`). Le détail est essentiel : un texte peut commencer **en milieu de page**. La détection se fait donc ligne par ligne, pas page par page. Le test le vérifie avec la directive fictive qui commence au milieu de la page 3.

## 2. Découper chaque texte en chunks (`chunker.py`)

### Stratégie `article` (par défaut) : 1 chunk = 1 article

**Pourquoi l'article ?**
- C'est **l'unité de sens** d'un texte juridique : une obligation, ses conditions, ses exceptions.
- C'est **l'unité de citation** : on cite « l'article 7 », jamais « les tokens 3 200 à 3 700 ».

**L'algorithme :**
1. Repérer les **sections** (`Titre`, `Chapitre`, `Section`, `Sous-section`) et garder le chemin courant : `Chapitre II Identification de la clientèle`. Le titre d'une section est souvent sur la ligne suivante : on l'ajoute.
2. Repérer les **articles** : `Article premier`, `Article 7`, `Article 7 bis`…
3. Le texte avant le premier article devient le chunk **Préambule** (visas, objet, date).
4. Chaque article va jusqu'à l'article ou la section suivante.
5. Un article **trop long** (plus de `CHUNK_MAX_TOKENS`, 800 par défaut) est coupé **par paragraphes**, avec un **chevauchement** de 100 tokens pour ne pas couper une phrase en deux sans contexte. Les parties sont marquées `(partie 1/3)`.

### Le piège des appels de note : « Article 2229 »

Dans le Recueil, une note de bas de page est collée au numéro : `Article 2229` signifie article 2 + note 229. Une simple expression régulière lirait « article 2229 ».

La solution utilise la **séquence** des articles (`resolve_article_number`) :
- après l'article 1, on attend un numéro entre 1 et 4 ;
- `2229` ne convient pas, mais son préfixe `2` oui : c'est l'article 2 ;
- `3230` après l'article 2 donne l'article 3, et `2345` après l'article 22 donne l'article 23.

Le titre est ensuite réécrit proprement dans le contenu (`Article 2229` devient `Article 2`).

### Les mentions qui ne sont pas des titres

« Article 34 de la loi n° 99-99 reste applicable… » en début de ligne n'est **pas** un nouvel article. Règle : si la suite commence par une **minuscule** (« de la loi »), c'est une mention. Les deux règles combinées, séquence et minuscule, sont couvertes par des tests.

### Le *contextual chunking*

Un article seul dit rarement de quel texte il vient : « Les établissements doivent identifier le bénéficiaire effectif… ». Chaque chunk reçoit donc un **en-tête de contexte** :

```
Circulaire n°5/W/2017 du 24 juillet 2017 relative à l'obligation de vigilance… | Chapitre II Identification de la clientèle | Article 2
```

Cet en-tête est **encodé avec le contenu** (embedding) et **indexé en plein texte**. Une question sur « la vigilance » retrouve ainsi l'article 2, même si le mot « vigilance » n'y figure pas.

### Stratégie `fixed` : la référence de comparaison

Une fenêtre glissante de N tokens avec chevauchement, sans tenir compte de la structure. Elle existe **pour être comparée** : on ingère deux fois (dans deux bases), on lance `make eval-retrieval` sur chacune et on compare hit@5 et MRR. C'est la façon de **prouver** que le découpage par article vaut mieux, au lieu de simplement l'affirmer.

```bash
CHUNK_STRATEGY=fixed  # dans .env, puis make reset-db && make ingest && make eval-retrieval
```

## 3. Ce qu'un chunk contient (table `chunks`)

| Champ | Exemple |
|---|---|
| `article` | `2`, `premier`, `7 bis`, `Préambule`, ou `null` (fixed) |
| `section_path` | `Chapitre II Identification de la clientèle` |
| `page_start` / `page_end` | 631 / 632 |
| `context` | l'en-tête ci-dessus |
| `content` | le texte de l'article |
| `token_count` | estimation : environ 1,3 token par mot |

## 4. Les réglages

| Variable | Défaut | Effet |
|---|---|---|
| `CHUNK_STRATEGY` | `article` | `article` ou `fixed` |
| `CHUNK_MAX_TOKENS` | 800 | Au-delà, l'article est coupé. Plus petit : recherche plus précise, mais moins de contexte |
| `CHUNK_OVERLAP_TOKENS` | 100 | Chevauchement entre parties |

Tout changement implique une **réingestion** (`make reset-db && make ingest`).
