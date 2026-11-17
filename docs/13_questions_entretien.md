# 13 — Questions techniques probables (et comment y répondre)

Les réponses ci-dessous sont des **pistes** : reformulez-les avec vos mots et appuyez-les sur ce que **vous** avez observé en lançant le projet.

---

## Présenter le projet (2 minutes)

> « RegAssist est un assistant RAG sur la réglementation bancaire marocaine. J'ai pris le recueil officiel de Bank Al-Maghrib, 1 268 pages. Je l'ai découpé texte par texte puis article par article, ce qui m'a obligé à traiter des pièges réels du PDF, comme les appels de note collés aux numéros d'article. Les articles sont indexés dans PostgreSQL avec pgvector et le plein texte français. La recherche est hybride, fusionnée par RRF. Un agent LangGraph reformule la question, filtre les extraits, rédige avec des citations, puis vérifie que chaque affirmation est soutenue par sa source. L'ingestion tourne en arrière-plan avec Celery et Redis, l'API est en FastAPI avec du streaming, le front en React. Tout est tracé dans Langfuse, et j'ai un script d'évaluation qui mesure la recherche et la fidélité des réponses. Le LLM est interchangeable : Claude, ou Llama en local avec Ollama. »

---

## Données et découpage

**Pourquoi découper par article ?**
C'est à la fois l'unité de sens juridique et l'unité de citation. Un découpage fixe coupe les obligations en deux et rend les citations imprécises. J'ai gardé la stratégie fixe pour pouvoir **mesurer** la différence avec mon jeu de test.

**Quelle a été la difficulté la plus intéressante ?**
Les appels de note collés : « Article 2229 » pour l'article 2 suivi de la note 229. Je l'ai résolu avec la séquence attendue des articles : après l'article 1, seuls les numéros de 1 à 4 sont plausibles, donc je prends le préfixe « 2 ». Plus une règle pour ne pas confondre une mention « Article 34 de la loi… » avec un titre. Les deux cas sont couverts par des tests.

**Comment séparez-vous les 170 textes du recueil ?**
Une ligne de titre (« Circulaire n° … ») suivie, dans les lignes suivantes, d'un préambule type (« Le Wali de Bank Al-Maghrib », « Vu… »). La double condition évite de couper sur une simple mention d'un texte dans un autre. La détection se fait ligne par ligne, parce qu'un texte peut commencer en milieu de page.

**Et les versions des textes, les abrogations ?**
Le recueil est consolidé, donc à jour à fin 2023. Pour la suite, j'ai un champ `status` (en vigueur / abrogé) et un champ `replaces`. La recherche exclut par défaut les textes abrogés, sauf si l'utilisateur cite explicitement la référence.

## Recherche

**Pourquoi une recherche hybride ?**
Les embeddings captent le sens mais sont faibles sur les identifiants comme « 5/W/2017 » et sur les termes rares. Le plein texte fait l'inverse. J'ai ajouté une troisième liste par référence normalisée. Je fusionne par RRF parce que les scores cosinus et `ts_rank` ne sont pas comparables : RRF n'utilise que les rangs.

**Pourquoi pgvector et pas Pinecone ?**
Un seul système à opérer, des filtres en SQL, le plein texte français intégré et des transactions. À mon volume (quelques milliers de chunks), une base dédiée n'apporte rien. Au-delà de plusieurs millions de vecteurs, je réévaluerais.

**HNSW ou IVFFlat ?**
HNSW est plus précis et ne demande pas de données pour être construit. IVFFlat se construit plus vite et prend moins de mémoire, mais il faut choisir le nombre de listes. À ce volume, HNSW.

**Comment améliorer la recherche ?**
D'abord mesurer (hit@5, MRR) et regarder les échecs. Ensuite : un reranker cross-encoder sur les 20 meilleurs candidats, l'ajustement de la taille des chunks, l'enrichissement du contexte, ou une reformulation de type HyDE. Je l'ai prévu (reranker optionnel), mais je ne l'active que si l'évaluation montre un gain.

## Agent et LLM

**Pourquoi LangGraph plutôt qu'une chaîne LangChain ?**
J'avais besoin de décisions et de boucles : hors sujet ou non, extraits pertinents ou non, reformuler et chercher à nouveau au maximum N fois, vérifier. Un graphe explicite reste prévisible et testable nœud par nœud, contrairement à un agent ReAct libre.

**Comment limitez-vous les hallucinations ?**
Quatre niveaux :
1. un prompt qui impose de citer et autorise à dire « les textes ne précisent pas » ;
2. le filtrage des extraits non pertinents avant la génération ;
3. un contrôle **déterministe** des citations (suppression des [n] qui n'existent pas) ;
4. un vérificateur LLM qui retire les affirmations non soutenues.

Et je **mesure** la fidélité ainsi que le taux de refus correct sur des questions pièges.

**Pourquoi ne pas diffuser les tokens ?**
Parce que l'étape de vérification peut retirer une affirmation. Je diffuse les étapes en direct, puis la réponse vérifiée. Dans un contexte réglementaire, afficher puis effacer est pire qu'attendre un peu.

**Comment gérez-vous les sorties JSON avec un modèle local ?**
Je ne dépends pas de l'appel d'outils natif : je demande du JSON, je l'extrais, je le valide avec Pydantic, je réessaie une fois avec le message d'erreur, puis je passe à une valeur par défaut sûre. Le même code tourne avec Claude et Llama.

**Combien coûte une question ?**
4 appels au LLM (5 sans le raccourci du routeur), visibles dans Langfuse avec les tokens. Les pistes pour réduire : un petit modèle pour le routage et l'évaluation des extraits, un cache, ou un vérificateur uniquement déterministe.

## Industrialisation

**Pourquoi Celery ?**
L'ingestion est longue. Elle ne doit ni bloquer l'API ni être perdue en cas de redémarrage. J'utilise un *chord* : des lots d'embeddings en parallèle, puis une finalisation. Les tâches échangent des identifiants, pas des données. Les traitements sont idempotents (SHA-256, `embedding IS NULL`), avec des relances automatiques sur les erreurs réseau, et `acks_late`.

**Comment testez-vous ?**
L'agent reçoit son LLM et son moteur de recherche par injection. Les tests unitaires utilisent un faux LLM. Les tests d'intégration tournent sur un vrai PostgreSQL avec pgvector, Celery en mode eager, et un PDF fictif qui reproduit les pièges du vrai recueil.

**Comment le déploieriez-vous en entreprise ?**
Docker Compose aujourd'hui. Ensuite : Kubernetes avec des workers séparés, Alembic pour les migrations, SSO et filtrage des documents par droits, secrets dans un coffre, embeddings et LLM hébergés en interne si les données sont sensibles, plus une alerte sur les métriques d'évaluation à chaque changement de prompt.

**Quel rapport avec Btechnologie ?**
Le même schéma s'applique aux procédures techniques, aux guides d'exploitation réseau ou aux comptes rendus d'incidents. Seuls le profil de nettoyage et le découpage changent (par procédure ou par section au lieu d'article). Le reste est réutilisable tel quel : recherche hybride, agent, évaluation, ingestion asynchrone.

---

## Les questions pièges

- *« Quel est votre hit@5 ? »* Donnez **votre** chiffre mesuré, le nombre de questions, et comment le golden set a été construit (généré **puis relu**).
- *« Qu'est-ce qui ne marche pas bien ? »* Les tableaux, les questions transverses qui demandent plus de 6 articles, la fraîcheur du corpus, le biais du juge LLM. Montrer qu'on connaît ses limites est un signe de maturité.
- *« Avez-vous tout écrit vous-même ? »* Soyez honnête sur les outils utilisés, et montrez que vous **maîtrisez** chaque choix : c'est ce qui compte, et c'est ce que l'entretien vérifie.
