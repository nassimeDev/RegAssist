# 05 — Embeddings et stockage dans pgvector

Fichiers : `backend/app/providers/embeddings.py`, `backend/app/db/models.py`

## 1. Qu'est-ce qu'un embedding, ici ?

Un modèle d'embeddings transforme un texte en un vecteur de nombres (1 024 pour bge-m3). Deux textes de **sens proche** ont des vecteurs proches, même sans mot commun. Par exemple, « client à risque élevé » et « mesures de vigilance renforcée ».

Le texte encodé pour chaque chunk est `context + "\n" + content` (voir [04](04_chunking.md)). La question de l'utilisateur est encodée par le même modèle, puis on cherche les chunks les plus proches.

## 2. Le choix du modèle : `bge-m3`

| Critère | bge-m3 |
|---|---|
| Langues | Multilingue, avec de bons résultats en **français et en arabe** (utile pour la version arabe du recueil) |
| Taille du contexte | jusqu'à 8 192 tokens : un article long tient entier |
| Coût | gratuit, local (Ollama ou sentence-transformers) |
| Dimension | 1 024 |

Les quatre fournisseurs disponibles (`EMBEDDING_PROVIDER`) :

| Valeur | Usage |
|---|---|
| `ollama` | **Par défaut.** `ollama pull bge-m3`, rien d'autre à installer côté Python |
| `sentence_transformers` | Le modèle tourne dans le worker (construire l'image avec `LOCAL_MODELS=1`, environ 2 Go) |
| `openai` | API payante. `text-embedding-3-small` donne une dimension de **1 536** : mettre `EMBEDDING_DIM=1536` |
| `hash` | Faux vecteurs déterministes pour les tests. Aucune notion de sens |

> ⚠️ **Règle d'or :** tous les chunks d'une base doivent être encodés avec **le même modèle**, et `EMBEDDING_DIM` doit correspondre au modèle. Changer de modèle implique de recréer la base (`make reset-db`) puis de réingérer. Le code vérifie la dimension et lève une erreur explicite en cas d'incohérence.

Les vecteurs sont **normalisés** (norme 1) : la similarité cosinus et le produit scalaire deviennent équivalents.

## 3. Pourquoi pgvector plutôt qu'une base vectorielle dédiée ?

| | pgvector | Pinecone / Weaviate / Chroma |
|---|---|---|
| Nombre de systèmes | **1** (PostgreSQL fait tout) | 2 (une base SQL **et** une base vectorielle) |
| Filtres (statut, thème, date) | SQL classique, jointures | API propre à chaque produit |
| Plein texte français | **intégré** (`tsvector`) | souvent absent ou limité |
| Transactions, sauvegardes | celles de PostgreSQL | à gérer à part |
| Volume visé | jusqu'à quelques millions de vecteurs sans difficulté | au-delà |

Pour quelques milliers ou dizaines de milliers de chunks, pgvector est le choix le plus simple et le plus robuste. C'est aussi la stack de la fiche de poste.

## 4. Le schéma

```
source_files (1) ──< documents (1) ──< chunks
     │                                   ├─ embedding  vector(1024)   ← index HNSW
     └──< ingestion_jobs                 └─ tsv        tsvector       ← index GIN (colonne calculée)
conversations (1) ──< messages
```

- **`source_files`** : un PDF, identifié par son **SHA-256**. Envoyer deux fois le même fichier ne crée rien de plus (idempotence).
- **`documents`** : un texte réglementaire (référence, date, thème, statut).
- **`chunks.tsv`** est une **colonne calculée** par PostgreSQL :
  ```sql
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('french', coalesce(context,'') || ' ' || content)) STORED
  ```
  L'application ne l'écrit jamais, donc elle ne peut pas être désynchronisée du texte.

## 5. Les index

```python
Index("ix_chunks_embedding_hnsw", "embedding", postgresql_using="hnsw",
      postgresql_with={"m": 16, "ef_construction": 64},
      postgresql_ops={"embedding": "vector_cosine_ops"})
Index("ix_chunks_tsv_gin", "tsv", postgresql_using="gin")
```

- **HNSW** (*Hierarchical Navigable Small World*) est un graphe de voisinage qui permet une recherche approximative des plus proches voisins, en temps quasi logarithmique. `m` règle le nombre de liens par nœud et `ef_construction` la qualité de la construction. Les valeurs par défaut sont adaptées à ce volume.
- L'alternative **IVFFlat** se construit plus vite mais demande de choisir le nombre de listes et d'avoir des données **avant** de créer l'index. HNSW n'a pas cette contrainte et il est plus précis.
- **GIN** est un index inversé : il donne, pour chaque mot (lexème), les chunks qui le contiennent.

## 6. Les commandes utiles

```sql
-- Combien de chunks encodés ?
SELECT count(*) FILTER (WHERE embedding IS NOT NULL), count(*) FROM chunks;
-- Les 5 chunks les plus proches d'un autre
SELECT c2.article, c2.context FROM chunks c1, chunks c2
WHERE c1.id = '<uuid>' ORDER BY c2.embedding <=> c1.embedding LIMIT 5;
```

`<=>` est l'opérateur de **distance cosinus** de pgvector. Il en existe deux autres : `<->` pour la distance L2 et `<#>` pour le produit scalaire négatif.
