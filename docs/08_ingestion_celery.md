# 08 — L'ingestion asynchrone avec Celery et Redis

Fichiers : `backend/app/ingestion/tasks.py`, `pipeline.py`, `backend/app/celery_app.py`

## 1. Le problème

Ingérer le Recueil prend du temps : extraction de 1 268 pages, plusieurs milliers de chunks, et surtout leurs **embeddings**. Faire tout cela pendant la requête HTTP `POST /documents` provoquerait :
- une expiration de la requête (timeout du navigateur ou de nginx) ;
- une API bloquée pour les autres utilisateurs ;
- aucune reprise possible en cas d'erreur.

## 2. La solution : une file de tâches

```
Navigateur ──POST /documents──▶ API ── 202 Accepted {job_id} (immédiat)
                                 │
                                 └── ingest_file.delay(job_id) ──▶ Redis (broker)
                                                                     │
                                         Worker(s) Celery ◀──────────┘
                                         ├─ ingest_file(job_id)        : extraction, nettoyage, textes, chunks
                                         └─ chord(
                                              group(embed_batch(lot_1), …, embed_batch(lot_N)),   ← en parallèle
                                              finalize_job(job_id)                                 ← quand tout est fini
                                            )
Navigateur ──GET /jobs/{id} toutes les 2 s──▶ progression (step, chunks_embedded / chunks_total)
```

- **Redis** joue deux rôles : c'est le **broker** (la file d'attente des tâches) et le **backend de résultats**, nécessaire au *chord* pour savoir quand toutes les tâches du groupe sont terminées.
- **Un *chord*** est un groupe de tâches parallèles suivi d'une tâche de rappel. Ici : N lots d'embeddings, puis `finalize_job`.

## 3. Les bonnes pratiques appliquées

| Pratique | Où | Pourquoi |
|---|---|---|
| **Échanger des identifiants, pas des données** | les tâches reçoivent `job_id` et des listes d'`chunk_ids` | Redis n'est pas fait pour transporter des mégaoctets de texte ; la base est la source de vérité |
| **Persister chaque étape** | `persist_units` puis `embed_chunks` | si un lot d'embeddings échoue, les chunks sont déjà en base et on ne refait que le lot |
| **Idempotence** | SHA-256 du fichier (`register_file`) ; `embed_chunks` ne traite que `embedding IS NULL` | renvoyer un fichier ou rejouer une tâche ne crée pas de doublons |
| **Relances automatiques** | `max_retries`, `retry_backoff` sur `embed_batch` (erreurs réseau) | Ollama ou une API d'embeddings peut être momentanément indisponible |
| **`task_acks_late=True`** | `celery_app.py` | si un worker plante en cours de tâche, la tâche est redistribuée |
| **`worker_prefetch_multiplier=1`** | `celery_app.py` | les tâches longues ne sont pas accaparées par un seul worker |
| **Compteur atomique** | `UPDATE … SET chunks_embedded = chunks_embedded + n` | plusieurs workers mettent à jour la progression en même temps sans conflit |

## 4. Les statuts d'une tâche (`ingestion_jobs`)

```
pending (queued) → running (extract → chunk → embed) → done
                                   └──────────────────→ failed (error renseigné)
duplicate : fichier déjà connu (même SHA-256), rien n'est fait
```

`progress` va de 0 à 1 : 0,05 après l'extraction, 0,2 après les chunks, puis de 0,3 à 1 au rythme des embeddings.

## 5. Monter en charge

- **Plus de workers** : `WORKER_CONCURRENCY=4` dans `.env`, ou `docker compose up -d --scale worker=3`. Les lots d'embeddings se répartissent automatiquement.
- **La taille des lots** (`EMBED_BATCH_SIZE`, 32) : de plus grands lots donnent moins d'appels mais plus de mémoire par appel.
- **Des files séparées** (évolution) : `queue="embeddings"` pour les tâches d'embeddings, avec des workers dédiés, sur GPU par exemple.

## 6. Tester et déboguer

- **`CELERY_EAGER=true`** : les tâches s'exécutent **dans le même processus**, sans Redis ni worker. Les tests d'intégration l'utilisent : le *chord* complet est exécuté et vérifié (`test_api_upload_and_job_tracking`).
- **Sans Celery** : `python -m scripts.ingest --file … --sync` appelle directement `ingest_sync()`.
- **Logs** : `make logs`.
- **Rejouer une ingestion échouée** : corriger la cause, supprimer le fichier source en base, puis renvoyer le PDF. Une évolution utile serait un endpoint `POST /jobs/{id}/retry`.
