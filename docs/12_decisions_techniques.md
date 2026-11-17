# 12 — Les décisions techniques (format ADR)

Chaque décision suit le même format : contexte, choix, alternatives écartées, conséquences. C'est le format des *Architecture Decision Records* : il montre la **prise de recul**, pas seulement le résultat.

---

### ADR-01 — Le corpus : le Recueil consolidé de BAM
- **Contexte :** il faut des textes officiels, nombreux, exploitables et à jour.
- **Choix :** le Recueil des textes législatifs et réglementaires (fin 2023), en un seul PDF natif.
- **Alternatives :** les circulaires une par une (dispersées, parfois scannées) ; le Bulletin officiel (scanné, mélangé).
- **Conséquences :** versions consolidées et pas d'OCR, mais des textes figés à fin 2023. Les compléments se font par `corpus.yaml` et `overrides`.

### ADR-02 — Le nettoyage par profils de règles explicites
- **Choix :** des règles écrites à partir de l'observation du vrai PDF (`bam_recueil`), plus un profil générique.
- **Alternatives :** unstructured ou Docling (lourds, utiles surtout pour les tableaux) ; un nettoyage par LLM (coûteux, non déterministe).
- **Conséquences :** rapide, testable, explicable. Chaque nouvelle source demande un profil.

### ADR-03 — Le découpage par article avec contexte
- **Choix :** 1 chunk = 1 article, avec l'en-tête « titre | section | article ». Les articles longs sont coupés par paragraphes avec chevauchement.
- **Alternatives :** une fenêtre fixe (coupe les articles, citations imprécises) ; un découpage sémantique (coûteux, résultat peu prévisible).
- **Conséquences :** des citations exactes et une meilleure recherche. À **prouver** par l'évaluation contre `fixed` (stratégie conservée pour la comparaison).

### ADR-04 — bge-m3 pour les embeddings, servi par Ollama par défaut
- **Choix :** un modèle multilingue, gratuit et local.
- **Alternatives :** OpenAI `text-embedding-3` (payant, données envoyées à l'extérieur) ; des modèles uniquement anglais.
- **Conséquences :** pas de coût, des données qui restent locales (argument fort en banque). Changer de modèle impose de réingérer.

### ADR-05 — pgvector plutôt qu'une base vectorielle dédiée
- **Choix :** PostgreSQL + pgvector (HNSW) + `tsvector` français.
- **Alternatives :** Pinecone, Weaviate, Qdrant, Chroma.
- **Conséquences :** un seul système, des filtres SQL, du plein texte intégré, des transactions. À reconsidérer au-delà de plusieurs millions de vecteurs.

### ADR-06 — La recherche hybride avec fusion RRF
- **Choix :** vecteur + plein texte + correspondance de référence, fusionnés par RRF (k = 60).
- **Alternatives :** le vecteur seul ; une combinaison pondérée des scores (poids à régler, scores non comparables).
- **Conséquences :** robuste sur le sens, les mots exacts et les identifiants. `RETRIEVAL_MODE` permet de mesurer l'apport de chaque méthode.

### ADR-07 — Un agent LangGraph avec évaluation et vérification
- **Choix :** un graphe avec routage, reformulation, évaluation des extraits (avec boucle bornée) et vérification en deux niveaux.
- **Alternatives :** une chaîne RAG simple ; un agent « ReAct » libre (moins prévisible, plus difficile à tester).
- **Conséquences :** moins d'hallucinations, un refus explicite, des étapes traçables. Le prix : 4 à 5 appels au LLM par question.

### ADR-08 — Une sortie structurée via un JSON validé (`complete_json`)
- **Choix :** demander du JSON, l'extraire, le valider avec Pydantic, réessayer une fois, sinon une valeur par défaut.
- **Alternatives :** `with_structured_output` / l'appel d'outils natif (variable selon les fournisseurs et les petits modèles locaux).
- **Conséquences :** le même code fonctionne avec Claude, OpenAI et Llama, et l'agent ne plante jamais sur une sortie mal formée.

### ADR-09 — Diffuser les étapes, et la réponse seulement une fois vérifiée
- **Choix :** le SSE envoie chaque étape, puis la réponse vérifiée.
- **Alternative :** diffuser les tokens au fil de l'eau (meilleure impression de vitesse).
- **Conséquences :** on n'affiche jamais une affirmation que la vérification retirera ensuite. Le temps d'attente est rendu visible par les étapes.

### ADR-10 — Celery + Redis avec un chord d'embeddings parallèles
- **Choix :** une tâche de parsing, puis un groupe de lots d'embeddings, puis la finalisation.
- **Alternatives :** `BackgroundTasks` de FastAPI (pas de relance, perdu si l'API redémarre) ; RQ ou Dramatiq (plus simples, mais Celery est la stack de la fiche).
- **Conséquences :** montée en charge en ajoutant des workers, relances, idempotence. Ajoute Redis à l'infrastructure.

### ADR-11 — Langfuse, optionnel
- **Choix :** des traces via les callbacks LangChain, des scores d'évaluation envoyés dans Langfuse, et rien d'obligatoire.
- **Alternatives :** LangSmith (propriétaire) ; des logs seulement (insuffisants pour déboguer un RAG).
- **Conséquences :** le débogage sépare la recherche de la génération. L'application fonctionne sans.

### ADR-12 — Injection de dépendances et faux composants pour les tests
- **Choix :** `build_graph(llm, retriever)`, `FakeLLM`, `HashEmbeddings`, `CELERY_EAGER`.
- **Conséquences :** 37 tests rapides, sans réseau ni coût, qui couvrent l'agent complet et l'intégration réelle avec PostgreSQL.

---

## Les limites connues (à citer spontanément en entretien)

1. **La fraîcheur du corpus :** consolidé à fin 2023. Les textes postérieurs doivent être ajoutés et les abrogations déclarées à la main.
2. **Les tableaux :** extraits en texte brut, ce qui fait perdre la structure ligne/colonne.
3. **Les questions transverses** (« comparez toutes les obligations de reporting ») : 6 chunks ne suffisent pas. Il faudrait une recherche multi-étapes ou une synthèse par texte.
4. **Le juge LLM :** il est biaisé et doit être calibré par une vérification humaine.
5. **La sécurité :** pas d'authentification ni de gestion des droits. Les PDF envoyés ne sont pas analysés par un antivirus.
6. **Les heuristiques de découpage :** elles sont réglées sur le format du Recueil. Un autre éditeur demandera un nouveau profil.
