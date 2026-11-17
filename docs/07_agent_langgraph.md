# 07 — L'agent LangGraph

Fichiers : `backend/app/agent/graph.py`, `prompts.py`, `citations.py` · `backend/app/providers/llm.py`

## 1. Pourquoi un agent plutôt qu'une chaîne RAG simple ?

Une chaîne simple fait toujours la même chose : **chercher → répondre**. Elle ne sait pas :
- reconnaître une question hors périmètre (et elle répond quand même) ;
- se rendre compte que les extraits trouvés ne répondent pas (et elle invente) ;
- vérifier ce qu'elle a écrit.

Un **graphe** LangGraph ajoute des **décisions** (arêtes conditionnelles), des **boucles** (reformuler puis chercher à nouveau) et des **contrôles**.

## 2. Le graphe

```
START → route ─┬─ salutation / hors_sujet → reply → END
               └─ reglementaire → rewrite → retrieve → grade ─┬─ pertinents → generate → verify → finalize → END
                                    ▲                          ├─ aucun, essais < N → rewrite (boucle)
                                    └──────────────────────────┘
                                                               └─ aucun, essais = N → no_answer → END
```

## 3. L'état partagé (`AgentState`)

Un `TypedDict` lu et complété par chaque nœud :

| Clé | Écrite par | Contenu |
|---|---|---|
| `question`, `history`, `filters` | l'API | entrée |
| `category`, `references` | route | classification, références normalisées |
| `search_query`, `rewrites` | rewrite | requête de recherche, nombre de reformulations |
| `candidates` | retrieve | chunks trouvés |
| `relevant`, `grade_reason` | grade | chunks retenus |
| `draft` | generate | brouillon |
| `answer`, `verification` | verify | réponse contrôlée, rapport |
| `sources` | finalize | sources réellement citées |
| `steps` | tous | journal. `Annotated[list, operator.add]` : chaque nœud **ajoute** ses entrées au lieu de remplacer la liste |

## 4. Les nœuds, un par un

**`route`**
- **Raccourci sans LLM :** si la question contient une référence (5/W/2017), elle est réglementaire. On gagne un appel au LLM.
- **Raccourci sans LLM :** une salutation simple (« bonjour », « merci »).
- Sinon, le LLM renvoie `{"category": "...", "references": [...]}`.

**`rewrite`**
- Rend la question **autonome** grâce à l'historique : « Et pour les personnes morales ? » devient « obligations d'identification pour les personnes morales ».
- Ajoute des termes juridiques équivalents.
- En cas de nouvel essai, le prompt indique la requête précédente et pourquoi elle a échoué : on demande une formulation **différente**.

**`retrieve`** : la recherche hybride de [06](06_recherche_hybride.md).

**`grade`**
- **Un seul appel** pour noter tous les extraits (`{"relevant": [1, 3], "reason": "..."}`), plutôt qu'un appel par extrait : 6 fois moins d'appels.
- Si la sortie est invalide, par défaut, tous les extraits sont gardés. On préfère une réponse prudente à un refus injustifié.

**`generate`** : le prompt `GENERATE_SYSTEM` impose de :
- citer chaque affirmation avec [n] ;
- n'utiliser aucune connaissance extérieure et ne deviner aucun chiffre ;
- dire explicitement ce que les textes ne précisent pas ;
- terminer par « Cette réponse ne constitue pas un avis juridique ».

**`verify`**, en deux niveaux :
1. **Déterministe** (`citations.drop_invalid`) : supprime les [n] qui pointent vers des sources inexistantes, par exemple [9] alors qu'il n'y a que 5 sources. C'est une hallucination fréquente, et la corriger ne coûte rien.
2. **LLM vérificateur :** chaque affirmation est-elle soutenue par la source citée ? Sinon, une `corrected_answer` retire les affirmations non soutenues.

**`finalize`** (`citations.renumber`) : renumérote les citations dans l'ordre d'apparition et ne garde que les sources citées. Si la réponse cite [3] puis [1], elles deviennent [1] et [2], et la liste affichée correspond exactement au texte.

**`no_answer`**, **`reply`** : des messages fixes (`prompts.py`), sans LLM.

## 5. La couche LLM (`providers/llm.py`)

Deux opérations suffisent à tous les nœuds :

```python
llm.complete(system, user, config)                         # → str
llm.complete_json(system, user, Schema, config, default)   # → instance Pydantic validée
```

**Pourquoi `complete_json` maison plutôt que `with_structured_output` ?**
Il fonctionne avec **tous** les modèles, y compris les petits modèles locaux qui gèrent mal l'appel d'outils :
1. on ajoute au prompt le schéma JSON attendu ;
2. on extrait le premier objet `{…}` de la réponse (y compris dans un bloc ```json) ;
3. on valide avec Pydantic ;
4. en cas d'échec, **un nouvel essai** en indiquant l'erreur ;
5. si ça échoue encore, on renvoie la valeur `default`, et l'agent ne plante jamais.

Les appels passent par les modèles de chat **LangChain** (`ChatAnthropic`, `ChatOpenAI`, `ChatOllama`). Le `config` transmis par LangGraph contient les callbacks Langfuse : chaque appel est tracé automatiquement.

## 6. L'injection de dépendances et les tests

```python
graph = build_graph(llm=FakeLLM(responder), retriever=FakeRetriever(chunks))
out = graph.invoke({"question": "..."})
```

`tests/test_agent.py` vérifie, sans réseau ni base :
- le chemin nominal (renumérotation, suppression de [9], ordre des étapes) ;
- le raccourci « référence », sans appel au routeur ;
- les salutations et les questions hors sujet ;
- 1 recherche + 2 reformulations, puis le refus propre ;
- l'utilisation de la correction du vérificateur.

## 7. Le streaming : pourquoi diffuser les étapes et pas les tokens ?

L'API diffuse en SSE **chaque étape** (« Recherche dans les textes… », « Vérification des citations… »), puis la **réponse vérifiée**.

Diffuser les tokens de `generate` au fur et à mesure afficherait des affirmations que `verify` pourrait ensuite **retirer**. Dans un contexte réglementaire, montrer puis effacer est pire qu'attendre deux secondes de plus. C'est un **choix de conception délibéré**, à expliquer en entretien.

## 8. Les coûts et la latence

Une question réglementaire fait **4 appels au LLM** : rewrite, grade, generate et verify (5 sans le raccourci de route). Avec Claude, cela prend quelques secondes. Avec Llama 8B sur CPU, de 20 à 60 secondes.

Les pistes, à mesurer avant d'agir :
- un modèle plus petit pour `route`, `rewrite` et `grade` ;
- désactiver `verify` LLM et ne garder que le contrôle déterministe ;
- un cache des questions fréquentes.
