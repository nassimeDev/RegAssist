# 06 — La recherche hybride

Fichiers : `backend/app/retrieval/hybrid.py`, `backend/app/retrieval/rerank.py`

## 1. Pourquoi la recherche vectorielle seule ne suffit pas

| Question | Vecteurs | Plein texte |
|---|---|---|
| « Que faire face à un client à risque ? » | ✅ comprennent le sens (« vigilance renforcée ») | ❌ aucun mot commun |
| « Que prévoit la 5/W/2017 ? » | ❌ un identifiant n'a pas de « sens » | ⚠️ le découpage en mots de PostgreSQL abîme « 5/W/2017 » |
| « Règles FATCA » | ⚠️ terme rare, mal représenté | ✅ correspondance exacte |

Chaque méthode a des angles morts. On les combine.

## 2. Les trois listes de candidats

```python
rankings = {
    "vector":    vector_search(query, filters, 20),     # distance cosinus, index HNSW
    "fulltext":  fulltext_search(query, filters, 20),   # tsvector français, index GIN
    "reference": reference_search(query, refs, filters, 20),  # seulement si la question cite une référence
}
```

**Vecteurs :** `ORDER BY embedding <=> :vecteur_question LIMIT 20`.

**Plein texte :**
- La requête est transformée en **OU** (`'oblig' | 'vigil' | 'client'`) pour qu'un chunk n'ait pas à contenir **tous** les mots.
- Le classement combine `ts_rank_cd` sur la requête OU et, avec un poids double, sur la requête « moteur de recherche » (`websearch_to_tsquery`). Les chunks qui contiennent **tous** les mots remontent.
- La configuration `french` gère la racinisation (« obligations » et « obligation » donnent le même lexème) et ignore les mots vides (« le », « de »…).

**Références :** `find_references()` repère « 5/W/2017 », « 5/W/17 » ou « 9/G/96 » dans la question, puis les normalise (`5/w/2017`). On récupère les chunks du ou des textes concernés, classés par pertinence plein texte. Cette liste **ignore le filtre « en vigueur »** : si l'utilisateur demande explicitement un texte, on le lui montre.

## 3. La fusion par RRF (*Reciprocal Rank Fusion*)

```
score(chunk) = Σ  1 / (k + rang dans la liste)      avec k = 60
           listes
```

Un exemple, avec k = 60 :

| Chunk | Rang vecteur | Rang plein texte | Score |
|---|---|---|---|
| A | 1 | — | 1/61 = 0,0164 |
| B | 2 | 1 | 1/62 + 1/61 = **0,0325** |
| C | — | 2 | 1/62 = 0,0161 |

B arrive en tête parce que **les deux méthodes sont d'accord**.

**Pourquoi RRF plutôt qu'une moyenne des scores ?** La similarité cosinus (de 0 à 1) et `ts_rank` (sans borne, selon la longueur du texte) ne sont pas comparables. Il faudrait les normaliser, avec des poids à régler. RRF n'utilise que les **rangs** : il n'y a rien à normaliser, le comportement est robuste, et k = 60 est la valeur standard de l'article d'origine (Cormack et al., 2009).

Les rangs de chaque liste sont gardés dans `RetrievedChunk.ranks`. Ils sont visibles dans les traces et utiles pour comprendre pourquoi un chunk est remonté.

## 4. Les filtres

```python
SearchFilters(only_in_force=True, themes=["3. LUTTE CONTRE LE BLANCHIMENT …"], references=[...])
```

- **`only_in_force`** (par défaut) : les textes marqués `abroge` sont exclus. Le statut se modifie dans l'onglet Documents ou par `PATCH /api/documents/{id}`.
- **`themes`** : le menu « Tous les thèmes » de l'interface.

## 5. Le reranking (optionnel)

`RERANKER=cross_encoder` avec le modèle `BAAI/bge-reranker-v2-m3`, nécessite `LOCAL_MODELS=1`.

Un **bi-encodeur** (l'embedding) encode la question et le chunk **séparément** : c'est rapide, mais approximatif. Un **cross-encodeur** lit la question **et** le chunk **ensemble** : c'est bien plus précis, mais trop lent pour toute la base. On ne l'applique donc qu'aux environ 18 meilleurs candidats issus de RRF (`top_k × 3`), puis on garde les `top_k`.

À activer **si l'évaluation montre un gain**, avec `make eval-retrieval` avant et après.

## 6. Les réglages

| Variable | Défaut | Rôle |
|---|---|---|
| `RETRIEVAL_MODE` | hybrid | `hybrid`, `vector` ou `fulltext` (pour mesurer l'apport de chaque méthode) |
| `RETRIEVAL_CANDIDATES` | 20 | candidats par liste |
| `RETRIEVAL_TOP_K` | 6 | chunks envoyés au LLM |
| `RRF_K` | 60 | constante de fusion |
| `RERANKER` | none | `none` ou `cross_encoder` |
| `ONLY_IN_FORCE` | true | filtre par défaut |

**Le compromis de `RETRIEVAL_TOP_K` :** une valeur plus grande augmente le rappel (la bonne réponse a plus de chances d'être là), mais aussi le bruit, le coût et la latence. L'étape `grade` de l'agent filtre ensuite les extraits inutiles.
