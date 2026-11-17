# 03 — Extraction du texte et nettoyage

Fichiers : `backend/app/ingestion/extract.py`, `backend/app/ingestion/clean.py`

## 1. L'extraction page par page (`extract.py`)

```python
pages = extract_pdf("recueil.pdf")      # → list[PageText(number, text, method, ocr_confidence)]
```

Pour chaque page :
1. **Texte natif** avec PyMuPDF (`page.get_text("text")`). C'est rapide (environ 1 268 pages en quelques secondes) et fidèle.
2. Si la page contient **moins de 50 caractères**, on la considère comme scannée : on la rend en image à 300 DPI puis on applique l'**OCR Tesseract** (`fra+ara`). La confiance moyenne de l'OCR est conservée.
3. `method` vaut `native`, `ocr` ou `empty`.

**Pourquoi décider page par page ?** Un même PDF peut mélanger des pages natives et des pages scannées (une annexe signée, par exemple). Décider pour tout le document ferait soit de l'OCR inutile (lent, avec des erreurs), soit raterait les scans.

**Pourquoi garder `method` ?** Pour pouvoir avertir que telle citation vient d'une page OCR, donc potentiellement moins fiable. C'est une évolution facile à ajouter dans l'interface.

Le Recueil BAM est entièrement natif : l'OCR ne sert que pour des documents ajoutés plus tard. Tesseract est installé dans l'image Docker avec les langues `fra` et `ara`.

## 2. Le nettoyage (`clean.py`)

Le nettoyage sert à **supprimer ce qui n'est pas du contenu** et à **réparer ce que l'extraction a abîmé**, sans jamais modifier le sens.

### Les normalisations communes (`normalize_text`)

| Problème | Avant | Après |
|---|---|---|
| Espaces insécables, apostrophes typographiques | `l’article` | `l'article` |
| Mots coupés en fin de ligne | `établisse-\nments` | `établissements` |
| Appels de note collés à un mot | `complétée24` | `complétée` |
| Espaces et sauts de ligne multiples | | réduits |

La règle des appels de note est **volontairement étroite** : on ne retire que 1 à 3 chiffres **collés à une lettre minuscule** (ou à une parenthèse) et suivis d'une espace ou d'une ponctuation. Ainsi `l'article 34`, `loi n° 103-12` et `10 ans` ne sont **pas** touchés : c'est vérifié par le test `test_normalize_text_keeps_real_numbers`.

### Le profil `generic`

Il supprime les lignes présentes sur au moins 50 % des pages : ce sont les en-têtes et pieds de page de n'importe quel document. C'est simple et indépendant de la source.

### Le profil `bam_recueil`

Il contient des règles spécifiques, issues de l'observation du vrai PDF (voir [02](02_jeu_de_donnees.md)) :
- supprimer les lignes de l'en-tête « RECUEIL DES TEXTES… », même coupées sur deux lignes ;
- lire la ligne `Mis à jour à fin 2023…` pour en **extraire la partie (le thème)**, puis la supprimer ;
- supprimer `PUBLIC` et les numéros de page isolés ;
- propager le thème aux pages suivantes ;
- vider les pages du préambule et de la table des matières.

```python
_parse_bam_header_line("Mis à jour à fin 20236313. LUTTE CONTRE…", page_number=631)
# → "3. LUTTE CONTRE…"   (le numéro de page 631, connu, est retiré en premier)
```

## 3. Ajouter une nouvelle source

Pour ajouter les circulaires de l'AMMC ou de l'ACAPS, par exemple :
1. Créer `clean_<source>_page()` sur le modèle de `clean_bam_recueil_page`.
2. Ajouter le nom dans `PROFILES` et la branche correspondante dans `clean_pages`.
3. Ajouter un PDF fictif qui imite sa mise en page dans `tests/fixtures/`, plus un test.
4. Mettre `profile: <source>` dans `corpus.yaml`.

## 4. Vérifier le résultat

```bash
make dry-run
# ou, hors Docker :
cd backend && python -m scripts.ingest --file ../data/raw/bam_recueil_2023.pdf --profile bam_recueil --dry-run --show 40
```

## Questions à se poser (et réponses)

- *Pourquoi ne pas utiliser un outil tout-en-un (unstructured, Docling) ?* Ils sont excellents pour les tableaux et les mises en page complexes, mais lourds. Ici, la structure est simple et régulière, et des règles explicites sont plus rapides, testables et explicables. Docling reste la piste d'évolution pour les tableaux.
- *Et si l'OCR se trompe sur un chiffre ?* C'est le risque principal des scans. La confiance OCR est enregistrée, on peut afficher un avertissement et privilégier la version native quand elle existe.
