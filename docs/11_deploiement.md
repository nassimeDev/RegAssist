# 11 — Déploiement et exécution

## 1. Avec Docker Compose (recommandé)

```bash
cp .env.example .env      # choisir un profil (A : Ollama, B : Claude, C : démo)
docker compose up -d --build
```

| Service | Image | Port | Rôle |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg16` | 5432 | base + vecteurs (crée aussi `regassist_test`) |
| `redis` | `redis:7-alpine` | 6379 | broker et résultats Celery |
| `api` | `./backend` | 8000 | FastAPI |
| `worker` | `./backend` (même image) | — | Celery |
| `frontend` | `./frontend` (nginx) | **3000** | interface + proxy `/api` |

- `api` et `worker` partagent **la même image**, seule la commande change. Le code est le même des deux côtés, donc pas de divergence possible.
- `./data` est monté dans `/app/data` : corpus, PDF envoyés et résultats d'évaluation restent sur votre disque.
- Les healthchecks garantissent que l'API ne démarre qu'une fois PostgreSQL et Redis prêts.
- Le schéma est créé au démarrage de l'API (`AUTO_INIT_DB=true`).

## 2. Llama en local avec Ollama

**Oui, RegAssist fonctionne entièrement sur votre ordinateur, sans clé API ni coût.**

```bash
# 1. Installer Ollama : https://ollama.com (Windows, macOS, Linux)
ollama pull llama3.1:8b     # LLM, ~4,7 Go
ollama pull bge-m3          # embeddings, ~1,2 Go
# 2. .env (profil A)
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIM=1024
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

`host.docker.internal` permet aux conteneurs de joindre Ollama installé **sur la machine hôte** (le compose ajoute `extra_hosts: host-gateway` pour Linux).

**Ce qu'il faut savoir :**

| Point | Détail |
|---|---|
| Mémoire | environ 8 Go de RAM libre pour le 8B (16 Go recommandés au total) |
| Vitesse | GPU NVIDIA ou Mac M1/M2/M3 : rapide. CPU seul : 20 à 60 s par réponse (4 à 5 appels au LLM par question) |
| Qualité | les petits modèles respectent moins bien les consignes (citer [n], refuser). Le `complete_json` tolérant et la vérification déterministe des citations compensent en partie. **Mesurez avec `make eval`** |
| Ingestion | les embeddings du recueil complet avec bge-m3 sur CPU peuvent prendre de longues minutes : c'est normal, suivez la progression dans l'onglet Documents |
| Autres modèles | `qwen2.5:7b` ou `mistral` (souvent bons en français), `llama3.1:70b` si vous avez beaucoup de mémoire. Changer `LLM_MODEL` suffit, sans réingestion |

> Changer de **LLM** ne demande **aucune** réingestion. Changer de modèle d'**embeddings** en demande une (`make reset-db && make ingest`).

**La combinaison recommandée pour une démo d'entretien :** Claude pour la génération (qualité), bge-m3 sur Ollama pour les embeddings (gratuit). Puis montrer qu'on passe à Llama en changeant **une seule ligne** de configuration.

## 3. Développement sans Docker pour le code

PostgreSQL et Redis restent dans Docker, le code tourne sur votre machine (rechargement automatique) :

```bash
docker compose up -d postgres redis
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows : .venv\Scripts\activate
pip install -e ".[dev]"
export DATABASE_URL=postgresql+psycopg://regassist:regassist@localhost:5433/regassist
export REDIS_URL=redis://localhost:6379/0 OLLAMA_BASE_URL=http://localhost:11434
uvicorn app.api.main:app --reload                       # terminal 1
celery -A app.celery_app worker --loglevel=INFO         # terminal 2 (Windows : ajouter --pool=solo)
cd ../frontend && npm install && npm run dev            # terminal 3 → http://localhost:5173
```

Pour éviter de lancer le worker en développement : `CELERY_EAGER=true`, les ingestions s'exécutent alors dans le processus de l'API.

## 4. Les tests

```bash
make test
# ou hors Docker :
cd backend && TEST_DATABASE_URL=postgresql+psycopg://regassist:regassist@localhost:5433/regassist_test pytest -v
```

- **21 tests unitaires** : références, nettoyage, découpage (dont le piège « Article 2229 »), RRF, citations, extraction JSON, agent complet avec un faux LLM.
- **4 tests d'intégration** (si `TEST_DATABASE_URL` est défini) : vrai PostgreSQL + pgvector, ingestion idempotente, recherche hybride (dont références abrégées et textes abrogés), envoi via l'API avec un *chord* Celery complet, chat synchrone et SSE avec historique.
- Les tests utilisent un **PDF fictif** généré à la volée (`tests/fixtures/make_pdf.py`), qui reproduit la mise en page du vrai recueil.

## 5. Le dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `EMBEDDING_DIM=… mais le modèle renvoie …` | dimension incorrecte | corriger `EMBEDDING_DIM`, puis `make reset-db` |
| `Connection refused … 11434` | Ollama non lancé, ou mauvaise URL | lancer Ollama ; dans Docker : `host.docker.internal` |
| Ingestion bloquée sur `pending` | worker arrêté | `docker compose ps`, puis `make logs` |
| La réponse arrive d'un bloc, sans étapes | un proxy met le flux en tampon | `proxy_buffering off` (déjà fait dans `nginx.conf`) |
| « Je n'ai pas trouvé… » partout | corpus non ingéré ou embeddings absents | `GET /api/health` : vérifier `chunks_embedded` |
| `ANTHROPIC_API_KEY manquant` | profil B sans clé | renseigner la clé, ou choisir le profil A |
