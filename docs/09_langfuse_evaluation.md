# 09 — Observabilité (Langfuse) et évaluation

Fichiers : `backend/app/observability.py`, `backend/eval/run_eval.py`, `backend/eval/build_golden_set.py`

## 1. Pourquoi c'est la partie la plus importante

Sans mesure, on ne peut pas dire si un changement de prompt, de découpage ou de modèle **améliore** ou **dégrade** le système. On a juste une impression sur trois questions testées à la main. L'évaluation transforme « je pense que c'est mieux » en « hit@5 passe de X à Y sur 40 questions ».

## 2. Les traces Langfuse

**Activation :** créer un compte sur Langfuse Cloud (gratuit) ou l'auto-héberger, puis renseigner dans `.env` :
```
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```
Sans ces clés, tout fonctionne : simplement, aucune trace n'est envoyée.

**Le fonctionnement :** `run_config()` ajoute un `CallbackHandler` Langfuse à la config passée à `graph.invoke()`. LangGraph transmet cette config à chaque nœud, et chaque nœud la transmet au modèle de chat LangChain. Résultat : **une trace par question**, avec :
- un span par nœud (route, rewrite, retrieve, grade…) ;
- pour chaque appel au LLM : le prompt complet, la réponse, les tokens, la latence et le coût ;
- la session = la conversation (`langfuse_session_id`), ce qui permet de suivre un échange sur plusieurs questions.

**Le débogage type :** une réponse est fausse. On ouvre la trace et on regarde dans l'ordre :
1. `rewrite` : la requête reformulée a-t-elle gardé le sens ?
2. `retrieve` : le bon article était-il parmi les candidats ? Si non, **le problème vient de la recherche** (découpage, embeddings, plein texte).
3. `grade` : l'a-t-on écarté à tort ?
4. `generate` : le LLM a-t-il mal lu la source ? Si oui, **le problème vient de la génération** (prompt, modèle).

Cette séparation entre recherche et génération est la question clé de tout débogage de RAG.

**L'auto-hébergement :** Langfuse v3 demande PostgreSQL, ClickHouse, Redis et S3/MinIO. Utilisez leur `docker-compose` officiel (dépôt `langfuse/langfuse`) plutôt que de l'ajouter ici, et pointez `LANGFUSE_HOST` dessus.

## 3. Le golden set (jeu de questions de référence)

Une ligne JSONL par question :
```json
{"id": "q001", "question": "Qui doit être identifié avant l'ouverture du compte d'une personne morale ?",
 "answerable": true, "expected_reference": "5/W/2017", "expected_articles": ["2"],
 "reference_answer": "Le bénéficiaire effectif…"}
{"id": "u001", "question": "Quel est le taux de l'IS au Maroc ?", "answerable": false}
```

**Comment le construire :**
1. `make golden` : le script tire 40 articles au hasard et demande au LLM une question réaliste et sa réponse **tirées de l'article**. Il ajoute aussi des **questions pièges**, sans réponse dans le corpus.
2. **Relire chaque ligne à la main** : corriger, supprimer, reformuler, et ajouter vos propres questions (les plus réalistes viennent d'un humain).
3. Enregistrer le résultat dans `data/golden_set.jsonl`.

> ⚠️ Un golden set généré mais **non relu** évalue le LLM avec ses propres erreurs. La relecture est non négociable.

**La composition conseillée (40 à 50 questions) :**
- 60 % de questions directes sur un article ;
- 15 % de questions par référence (« que dit la 5/W/2017 sur… ») ;
- 10 % de questions qui demandent 2 articles ;
- 15 % de questions **sans réponse** (hors corpus, ou texte inexistant).

## 4. Les métriques

| Métrique | Mesure | Calcul |
|---|---|---|
| **hit@k** | la recherche trouve-t-elle le bon article ? | 1 si un des k premiers chunks a la référence **et** l'article attendus |
| **MRR** | à quel rang ? | moyenne de 1/rang (1 = toujours premier ; 0,5 = en moyenne deuxième) |
| **fidélité** (*faithfulness*) | la réponse n'invente-t-elle rien ? | LLM juge : part des affirmations soutenues par les sources |
| **exactitude** (*correctness*) | la réponse est-elle juste ? | LLM juge : comparaison avec la réponse de référence |
| **citation_ok** | cite-t-on le bon texte ? | 1 si une source citée a la référence attendue |
| **refusal_ok** | refuse-t-on d'inventer ? | sur les questions sans réponse : 1 si l'agent refuse |

**Le LLM juge :** il est pratique mais imparfait. On vérifie **manuellement** un échantillon (10 réponses) pour s'assurer que ses notes sont cohérentes avec un jugement humain. Si possible, on utilise comme juge un modèle **plus fort** que celui qui répond.

## 5. Lancer une évaluation

```bash
make eval-retrieval   # recherche seule : gratuit, quelques secondes, sans LLM
make eval             # complet : agent + juge, scores envoyés dans Langfuse
```

Le résultat est un tableau dans le terminal, plus un fichier JSON détaillé dans `data/eval_results/` (configuration utilisée, réponse et rang pour chaque question).

## 6. Comparer deux configurations (la démarche à montrer en entretien)

```bash
# Expérience 1 : découpage par article (défaut)
make reset-db && make ingest
docker compose exec api python -m eval.run_eval --golden /app/data/golden_set.jsonl --retrieval-only --label article

# Expérience 2 : découpage fixe
# .env : CHUNK_STRATEGY=fixed, puis : docker compose up -d
make reset-db && make ingest
docker compose exec api python -m eval.run_eval --golden /app/data/golden_set.jsonl --retrieval-only --label fixed
```

Le même principe s'applique pour comparer la recherche vectorielle seule et la recherche hybride (`RETRIEVAL_MODE=vector` ou `hybrid`, sans réingestion), l'activation du reranker, ou Claude et Llama (avec `make eval`).

**Le tableau à remplir avec VOS chiffres :**

| Expérience | hit@5 | MRR | fidélité | refus correct |
|---|---|---|---|---|
| article + hybride | … | … | … | … |
| fixed + hybride | … | … | … | … |
| article + vecteur seul | … | … | … | … |

> Ne présentez en entretien **que des chiffres que vous avez mesurés vous-même**, et sachez expliquer comment.
