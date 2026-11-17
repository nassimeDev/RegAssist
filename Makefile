# Raccourcis RegAssist.  `make help` pour la liste.
COMPOSE = docker compose
EXEC    = $(COMPOSE) exec api
TEST_DB = postgresql+psycopg://regassist:regassist@postgres:5432/regassist_test

.PHONY: help env up down logs ps download ingest dry-run test lint eval eval-retrieval golden reset-db dev-api dev-worker dev-front

help:  ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

env:  ## Crée .env à partir de .env.example
	@test -f .env || cp .env.example .env && echo ".env prêt — vérifiez le profil choisi"

up: env  ## Construit et démarre toute la stack (http://localhost:3000)
	$(COMPOSE) up -d --build

down:  ## Arrête la stack (les données sont conservées)
	$(COMPOSE) down

logs:  ## Suit les logs de l'API et du worker
	$(COMPOSE) logs -f api worker

ps:  ## État des conteneurs
	$(COMPOSE) ps

download:  ## Télécharge le corpus (data/corpus.yaml → data/raw/), depuis le conteneur
	$(EXEC) python -m scripts.download_corpus --corpus /app/data/corpus.yaml --out /app/data/raw

dry-run:  ## Montre le découpage du recueil SANS écrire en base
	$(EXEC) python -m scripts.ingest --file /app/data/raw/bam_recueil_2023.pdf --profile bam_recueil --dry-run

ingest:  ## Ingère le corpus téléchargé via Celery (suivi dans l'onglet Documents)
	$(EXEC) python -m scripts.ingest --corpus /app/data/corpus.yaml --raw-dir /app/data/raw

test:  ## Lance tous les tests (unitaires + intégration sur PostgreSQL)
	$(EXEC) env TEST_DATABASE_URL=$(TEST_DB) pytest -v

lint:  ## Vérifie le style du code Python
	$(EXEC) ruff check app tests scripts eval

golden:  ## Génère des questions candidates pour le golden set (à relire !)
	$(EXEC) python -m eval.build_golden_set --n 40 --out /app/data/golden_candidates.jsonl

eval-retrieval:  ## Évalue la recherche seule (gratuit, sans LLM)
	$(EXEC) python -m eval.run_eval --golden /app/data/golden_set.jsonl --retrieval-only --out /app/data/eval_results

eval:  ## Évaluation complète (agent + LLM juge, scores envoyés à Langfuse)
	$(EXEC) python -m eval.run_eval --golden /app/data/golden_set.jsonl --out /app/data/eval_results

reset-db:  ## ⚠️ Supprime toutes les tables et les recrée (réingestion nécessaire)
	$(EXEC) python -m app.db.init_db --drop

# --- Développement sans Docker pour le code (PostgreSQL et Redis restent dans Docker)
dev-api:  ## API en rechargement automatique (port 8000)
	cd backend && uvicorn app.api.main:app --reload

dev-worker:  ## Worker Celery local
	cd backend && celery -A app.celery_app worker --loglevel=INFO

dev-front:  ## Frontend Vite (http://localhost:5173)
	cd frontend && npm install && npm run dev
