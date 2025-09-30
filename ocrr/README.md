# Afibel OCR Extraction Toolkit

Application full-stack en JavaScript permettant de :

- Extraire le texte d'un bon de commande scanne via Google Cloud Vision ou Azure Vision.
- Structurer automatiquement les lignes de commande grace au LLM Groq.
- Reconciler les donnees avec le catalogue interne (references, modeles, coloris, prix) et signaler les points a valider.
- Exporter les lignes valides dans Google Sheets pour suivi client.

## Prerequis

- Node.js 18 ou version ulterieure.
- Une cle Groq (LLM).
- Un fournisseur OCR : Google Vision (compte de service) ou Azure AI Vision.
- (Optionnel) Un Google Sheet accessible par un compte de service.

## Installation

1. Installez les dependances :
   ```bash
   npm install
   ```
2. Copiez `.env.example` vers `.env` et remplissez vos identifiants.
3. Placez les credentials Google Vision dans `secrets/vision-credentials.json` ou ajustez `GOOGLE_APPLICATION_CREDENTIALS`.
4. Demarrez l'application :
   ```bash
   npm start
   ```
5. Ouvrez `http://localhost:3000`.

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `PORT` | Port HTTP du serveur (defaut `3000`). |
| `LLM_PROVIDER` | Laisser `groq`. |
| `GROQ_API_KEY` | Cle API Groq. |
| `GROQ_MODEL` | Modele Groq (ex : `meta-llama/llama-4-scout-17b-16e-instruct`). |
| `FALLBACK_TO_MOCK` | `1` pour activer un JSON fictif (debug). |
| `OCR_PROVIDER` | `google` ou `azure`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Chemin vers le fichier de credentials Vision. |
| `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY` | Endpoint + cle Azure si `OCR_PROVIDER=azure`. |
| `ENABLE_GOOGLE_SHEETS` | `1` pour autoriser l'export. |
| `GOOGLE_SHEET_ID` | Identifiant du Google Sheet cible. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Compte de service Sheets. |
| `ENABLE_VALIDATION_AGENT` | `1` pour activer l'agent IA de correction. |
| `VALIDATION_MAX_ATTEMPTS` | Nombre max de tentatives (defaut 3). |
| `AUTO_EXPORT_ON_PROCESS` | `1` pour lancer l'export automatiquement. |
| `REFERENCE_LENGTH` | Longueur de reference attendue (defaut 7). |
| `COLOR_MIN_LENGTH` | Longueur minimale d'un coloris (defaut 4). |
| `MAX_QUANTITY` | Quantite maxi autorisee (defaut 10). |
| `MIN_PRICE_VALUE` | Prix minimum considere valide (defaut 10). |
| `MAX_REFERENCE_DISTANCE` | Distance max pour corriger une reference via Levenshtein (defaut 1). |
| `MAX_MODEL_DISTANCE` | Distance max pour corriger un modele via Levenshtein (defaut 2). |

## Pipeline

1. Upload (image/PDF/JSON) depuis le frontend.
2. OCR via Google ou Azure.
3. Structuration Groq.
4. Post-traitement :
   - normalisation des champs (accents, ponctuation, separateurs taille/reference) ;
   - rapprochement des references (Levenshtein) ;
   - fallback sur le modele + coloris si la reference manque ;
   - injection systematique des donnees du catalogue (modele, coloris, taille, prix).
5. Si des incoherences subsistent, l'agent IA tente des corrections ; sinon la ligne est marquee `needs_review`.
6. Le frontend affiche les lignes en surbrillance pour validation et propose l'export Google Sheets.

## Regles de validation

- References : 7 caracteres, correction automatique si un seul chiffre differe (grace au catalogue).
- Taille collee : `442903142` devient reference `4429031`, taille `42`.
- Modeles : matching fuzzy avec distance `MAX_MODEL_DISTANCE` (cas `Mules Kala`, etc.).
- Coloris : normalisation (uppercase, corrections typiques) et rejet si < `COLOR_MIN_LENGTH`.
- Quantites : 1 par defaut si absente ou > `MAX_QUANTITY`.
- Prix : normalises en deux decimales, rejetes si < `MIN_PRICE_VALUE`.
- Toute ligne sans correspondance catalogue reste `needs_review`.

## Tests rapides

```bash
npm run pipeline:test
```

Ce script execute OCR + Groq + post-traitement + export (avec historique des tentatives).

## OCR Azure

1. Creez une ressource "Computer Vision" dans le portail Azure et recuperer endpoint + cle.
2. Dans `.env` :
   ```bash
   OCR_PROVIDER=azure
   AZURE_VISION_ENDPOINT=https://<votre-endpoint>.cognitiveservices.azure.com/
   AZURE_VISION_KEY=<votre-cle>
   ```
3. Redemarrez l'application.

(Repassez sur `OCR_PROVIDER=google` pour revenir a Google Vision.)

## Securite

- Ne stockez pas vos cles dans `public/`.
- Ne commitez pas les secrets (Groq, Google, Azure).
- Limitez les droits des comptes de service au strict necessaire.
