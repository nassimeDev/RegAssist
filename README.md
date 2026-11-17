# RegAssist

**AI assistant for Moroccan banking regulation (Bank Al-Maghrib), built with RAG and a LangGraph agent. Every answer cites its sources.**

Ask a question in plain French, for example *"Comment identifier le bénéficiaire effectif d'une personne morale ?"*. RegAssist searches the official texts, writes an answer and **cites each statement** (circular, article, page). When the texts don't contain the answer, it says so instead of making one up.

🔗 **Live demo:** _coming soon_

---

## Why it matters

Compliance teams spend hours searching through the 1,200+ page *Recueil des textes législatifs et réglementaires* of Bank Al-Maghrib. A generic chatbot is not acceptable here: one invented threshold or deadline is a compliance risk. RegAssist is designed around one rule: **no source, no claim.**

## What it does

- **Understands the structure of legal texts.** The Recueil is split into ~170 regulatory texts (circulars, directives, laws, decrees), then into articles. One chunk = one article = one citation.
- **Hybrid search.** Vector search (meaning) + French full-text search (exact legal terms) + reference matching (`5/W/2017`), fused with Reciprocal Rank Fusion, with optional cross-encoder reranking.
- **Agent that checks its own work.** A LangGraph agent routes the question, rewrites it, grades the retrieved passages, writes the answer with citations, then verifies each claim against its source.
- **Ignores repealed texts** by default (texts are tagged *en vigueur* / *abrogé*).
- **Works with any LLM.** Claude, OpenAI, or a local model (Llama, Mistral, Qwen) through Ollama: one environment variable to switch.
- **Scales ingestion.** PDF ingestion runs asynchronously in Celery workers; embedding batches run in parallel.

## Architecture

```
               ┌──────────────┐
  User ───────▶│  React UI    │  chat with streaming + clickable citations
               └──────┬───────┘
                      │ REST / SSE
               ┌──────▼───────┐        ┌──────────────────────────────┐
               │   FastAPI    │───────▶│  LangGraph agent             │
               └──────┬───────┘        │  route → rewrite → retrieve  │
                      │                │  → grade → generate → verify │
         upload PDF   │                └──────────────┬───────────────┘
               ┌──────▼───────┐                       │ hybrid search
               │ Celery + Redis│               ┌──────▼──────────────────────┐
               │  ingestion    │──────────────▶│ PostgreSQL + pgvector       │
               └──────────────┘   OCR, split,  │ HNSW vectors + French FTS   │
                                  chunk, embed └─────────────────────────────┘
                                                        │
                                       Langfuse: traces, latency, cost, scores
```

## Ingestion pipeline

| Step | What happens |
|---|---|
| 1. Extract | PyMuPDF reads native text; scanned pages fall back to Tesseract OCR (French + Arabic) |
| 2. Clean | Removes repeated headers, glued footnote numbers, hyphenated line breaks; keeps the Recueil's theme for each page |
| 3. Split | Detects where each regulatory text starts (title + preamble) and extracts its reference and date |
| 4. Chunk | One chunk per article, with a context header (*Circulaire 5/W/2017 › Chapitre II › Article 7*); long articles are split with overlap |
| 5. Embed | `bge-m3` embeddings (1024 dims), computed in parallel batches by Celery workers |

## Tech stack

| Layer | Tools |
|---|---|
| LLM & agent | LangGraph, LangChain, Claude / OpenAI / Ollama (Llama, Mistral, Qwen) |
| Retrieval | PostgreSQL + pgvector (HNSW), French full-text search, RRF fusion, `bge-reranker-v2-m3` |
| Embeddings | `bge-m3` via Ollama or sentence-transformers |
| Backend | FastAPI, SQLAlchemy 2.0, Celery, Redis |
| Documents | PyMuPDF, Tesseract OCR |
| Observability | Langfuse (traces, latency, cost, evaluation scores) |
| Frontend | React |
| Deployment | Docker Compose |

## Run it locally

```bash
git clone https://github.com/nassimeDev/RegAssist.git
cd RegAssist
cp .env.example .env            # choose your LLM provider and keys
docker compose up -d --build    # API, worker, PostgreSQL, Redis, UI
make download                   # download the Bank Al-Maghrib corpus
make ingest                     # index it
```

Open the UI at `http://localhost:5173` and ask a question.

To run fully offline with a local model:

```env
LLM_PROVIDER=ollama
LLM_MODEL=llama3.1:8b
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=bge-m3
```

## Evaluation

A golden set of real compliance questions with their expected source articles measures:
- **Retrieval:** is the right article in the top results? (hit rate, MRR)
- **Answers:** faithfulness to sources, correct citations, honest "I don't know" when the texts are silent.

Results are logged to Langfuse so every prompt or retrieval change can be compared before and after.

## Roadmap

- [ ] Public live demo
- [ ] MCP server: expose RegAssist search as a tool for any MCP client
- [ ] RAGAS evaluation report in the README
- [ ] GitHub Actions CI (lint, tests, Docker build)
- [ ] Arabic-language texts

## Disclaimer

RegAssist is a research and demonstration project. Its answers are not legal advice.

## Author

**Nassime Alalou**, AI Engineer · [LinkedIn](https://www.linkedin.com/in/nassime-alalou-611073243/) · nassim252samir@gmail.com