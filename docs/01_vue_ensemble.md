# 01 — Vue d'ensemble

## Le problème

Un responsable conformité, un juriste ou un analyste bancaire doit souvent retrouver **ce que dit exactement la réglementation** : « Quelles pièces faut-il pour une demande d'agrément ? », « Que prévoit la circulaire 5/W/2017 sur le bénéficiaire effectif ? ».

Les textes existent, mais ils sont dispersés dans un PDF de 1 268 pages, et la recherche par mot-clé (Ctrl+F) passe à côté des synonymes. Un chatbot généraliste, lui, répond avec assurance… parfois faux, et sans source.

**Objectif de RegAssist :** répondre en langage naturel, **uniquement à partir des textes officiels**, en **citant** le texte, l'article et la page, et en **refusant** de répondre quand les textes ne le permettent pas.

Ce dernier point est le plus important. Dans un domaine réglementaire, une réponse inventée coûte plus cher qu'une absence de réponse. C'est pour cela que le projet investit dans les citations, la vérification et l'évaluation.

## L'architecture

```
                         ┌───────────────────────── INGESTION (asynchrone) ─────────────────────────┐
  PDF officiel ──upload──▶ API ──job──▶ Redis ──▶ Worker Celery                                      │
                         │                          extract → clean → split → chunk ─┐              │
                         │                          embed (lots en parallèle) ◀──────┘              │
                         │                                   │                                       │
                         └───────────────────────────────────▼───────────────────────────────────────┘
                                                  PostgreSQL + pgvector
                                         documents · chunks (vecteur + tsvector)
                         ┌───────────────────────────────────▲─────────────── QUESTION (synchrone) ─┐
  Utilisateur ──question─▶ React ──SSE──▶ API ──▶ Agent LangGraph                                    │
                         │                         route → rewrite → retrieve → grade               │
                         │                         → generate → verify → finalize                   │
                         │                                    │                                     │
                         │                              LLM (Claude / Llama)                         │
                         └──────────────────── traces ──▶ Langfuse ─────────────────────────────────┘
```

Il y a deux flux indépendants :

1. **L'ingestion** (lente, rare) : transformer des PDF en passages indexés. Elle tourne en arrière-plan avec Celery pour ne jamais bloquer l'API.
2. **La question** (rapide, fréquente) : l'agent cherche, rédige et vérifie. Il diffuse ses étapes en direct à l'interface.

## Le parcours d'une question, pas à pas

Prenons la question « Qui doit être identifié avant d'ouvrir le compte d'une société ? ».

| Étape | Nœud | Ce qui se passe |
|---|---|---|
| 1 | `route` | Question réglementaire ? Oui. (S'il y avait une référence comme « 5/W/2017 », aucun appel LLM ne serait fait.) |
| 2 | `rewrite` | Le LLM produit une requête autonome et enrichie : « identification bénéficiaire effectif personne morale ouverture de compte » |
| 3 | `retrieve` | Recherche hybride : 20 candidats par les vecteurs, 20 par le plein texte, fusion RRF, 6 conservés |
| 4 | `grade` | Le LLM indique quels extraits sont réellement utiles. S'il n'y en a aucun, on reformule (2 fois maximum), puis on abandonne proprement |
| 5 | `generate` | Réponse rédigée **uniquement** à partir des extraits retenus, chaque affirmation suivie de [n] |
| 6 | `verify` | Contrôle sans LLM (citations [n] existantes ?) puis contrôle par LLM (chaque affirmation est-elle soutenue ?) |
| 7 | `finalize` | Renumérotation des citations, liste des sources réellement citées |

L'interface affiche chaque étape en direct, puis la réponse vérifiée. Un clic sur [1] ouvre le passage exact.

## Les principes de conception

- **Tout est configurable** (`backend/app/config.py`) : LLM, embeddings, découpage, recherche. On compare des variantes sans toucher au code.
- **Des dépendances injectées** : l'agent reçoit son LLM et son moteur de recherche en paramètres. Les tests utilisent des faux, sans réseau ni base.
- **Des étapes persistées** : l'ingestion écrit en base à chaque étape. Les tâches Celery ne s'échangent que des identifiants.
- **Des contrôles déterministes d'abord, le LLM ensuite** : tout ce qui peut être vérifié par du code (citations, références, idempotence) l'est. Le LLM sert au jugement.
- **Mesurer avant d'affirmer** : un script d'évaluation produit des chiffres (hit@k, MRR, fidélité). On ne cite que des chiffres mesurés.

## Où se trouve le code

| Besoin | Fichier |
|---|---|
| Changer un réglage | `backend/app/config.py`, `.env` |
| Comprendre l'ingestion | `backend/app/ingestion/pipeline.py`, puis chaque étape |
| Comprendre la recherche | `backend/app/retrieval/hybrid.py` |
| Comprendre l'agent | `backend/app/agent/graph.py` (schéma en tête de fichier) |
| Modifier un prompt | `backend/app/agent/prompts.py` |
| Ajouter un endpoint | `backend/app/api/routes/` |
| Modifier l'interface | `frontend/src/components/` |
