# 14 — Faire évoluer le projet

## Où modifier quoi

| Je veux… | Fichier(s) | Attention |
|---|---|---|
| changer de LLM | `.env` (`LLM_PROVIDER`, `LLM_MODEL`) | relancer `make eval` pour comparer |
| ajouter un fournisseur de LLM | `app/providers/llm.py → build_chat_model` | tout modèle de chat LangChain convient |
| changer de modèle d'embeddings | `.env` (`EMBEDDING_*`) | **réingestion** + `EMBEDDING_DIM` correct |
| ajouter une source de documents | `app/ingestion/clean.py` (profil), `data/corpus.yaml` | ajouter un PDF fictif et un test |
| reconnaître un nouveau type de texte | `splitter.py → DOC_TYPES`, `PREAMBLE_RE` | tester avec `--dry-run` |
| modifier un prompt | `app/agent/prompts.py` | évaluer avant et après |
| ajouter un nœud à l'agent | `app/agent/graph.py` (+ `STEP_LABELS` dans `services/chat.py`) | ajouter un test dans `test_agent.py` |
| ajouter un endpoint | `app/api/routes/*.py`, `schemas.py` | mettre à jour `frontend/src/api.ts` |
| ajouter une colonne | `app/db/models.py` | sans Alembic : `make reset-db` (voir plus bas) |

## La feuille de route proposée

**Court terme (fiabilité)**
1. Construire et **relire** un golden set de 40 à 50 questions, puis remplir le tableau de [09](09_langfuse_evaluation.md#6-comparer-deux-configurations-la-démarche-à-montrer-en-entretien).
2. Ajouter **Alembic** pour les migrations (`alembic init`, `target_metadata = Base.metadata`).
3. `POST /jobs/{id}/retry` et la suppression d'un fichier source avec ses documents.
4. Un avertissement dans l'interface quand une source vient d'une page OCR.

**Moyen terme (qualité)**
5. Le reranker cross-encoder, activé **si** l'évaluation le justifie.
6. La version **arabe** du recueil : bge-m3 la gère déjà, il faut un golden set en arabe et un prompt bilingue.
7. Les **tableaux** avec Docling, avec un chunk par tableau au format Markdown.
8. Les liens entre textes : extraire « modifiée par la circulaire X » des notes de bas de page pour construire `replaces` automatiquement.
9. Le retour utilisateur (👍/👎) envoyé comme score Langfuse.

**Long terme (industrialisation)**
10. Authentification (SSO / OIDC) et filtrage des documents selon les droits.
11. Des files Celery séparées (embeddings sur GPU) et le passage à Kubernetes.
12. Une CI : `ruff` + `pytest` + `eval-retrieval` à chaque merge request, qui échoue si hit@5 baisse.

## Les conventions du code

- Python ≥ 3.11, typage partout, `ruff check` sans erreur.
- Les commentaires et la documentation sont en français, les noms de code en anglais.
- Chaque bug corrigé dans le découpage s'accompagne d'un test qui le reproduit (voir `tests/test_ingestion.py`).
- Aucun secret dans le code : tout passe par `.env`, et `.env` n'est jamais versionné.
