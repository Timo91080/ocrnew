const { callGroqJSON } = require('./groqClient');
const { getCatalogPromptSnippet } = require('./catalog');

const REFERENCE_LENGTH = Number(process.env.REFERENCE_LENGTH || 7);
const COLOR_MIN_LENGTH = Number(process.env.COLOR_MIN_LENGTH || 4);
const MAX_QUANTITY = Number(process.env.MAX_QUANTITY || 10);
const MIN_PRICE_VALUE = Number(process.env.MIN_PRICE_VALUE || 10);
const PROMPT_CATALOG_LIMIT = Number(process.env.PROMPT_CATALOG_LIMIT || 60);

function buildValidationPrompt({ items, ocrText, apiErrorMessage, attempt }) {
  const itemsJson = JSON.stringify(items, null, 2);
  const catalogSnippet = getCatalogPromptSnippet(PROMPT_CATALOG_LIMIT);
  return `Tu es un agent de validation pour des bons de commande Afibel.
Tu dois corriger les lignes pour respecter strictement les contraintes suivantes :
- reference_ocr : exactement ${REFERENCE_LENGTH} caracteres alphanumeriques (apres retrait des separateurs). Si la reference OCR contient 7 chiffres suivis d'une taille (ex: 442903142), isole les 7 premiers chiffres et reporte la taille dans size_or_code_raw.
- coloris_raw : texte >= ${COLOR_MIN_LENGTH} caracteres (apres trim). Applique la casse originale si disponible.
- quantity_raw : entier positif <= ${MAX_QUANTITY}.
- unit_price_raw : nombre decimal avec point et 2 decimales (ex: 16.99) et >= ${MIN_PRICE_VALUE}.
- model_name_raw : ne doit pas etre un coloris. Si seul le coloris est disponible, laisse model_name_raw a null.

Tu disposes du catalogue (references -> modele | coloris | taille | prix) ci-dessous. Utilise-le obligatoirement pour verifier/recuperer les valeurs exactes :
---
${catalogSnippet}
---

Tu recois :
- le texte OCR brut
- les lignes actuelles
- le message d'erreur API

Consigne :
1. Utilise le texte OCR pour retrouver les valeurs manquantes/corriger les erreurs.
2. Replace chaque champ par la valeur exacte du catalogue correspondant a la reference.
3. Si tu n'es pas sur, laisse la valeur a null et explique dans "notes".
4. Rends du JSON strict : {
  "items": [...],
  "notes": string|null
}

Tentative actuelle : ${attempt}
Erreur API : ${apiErrorMessage || 'inconnue'}

Texte OCR :
---
${ocrText || 'non fourni'}
---

Items actuels :
${itemsJson}
`;
}

async function runValidationAgent({ items, ocrText, apiErrorMessage, attempt }) {
  const { parsed, rawText } = await callGroqJSON({
    prompt: buildValidationPrompt({ items, ocrText, apiErrorMessage, attempt }),
    mockResult: {
      items,
      notes: 'Mode mock : aucune correction appliquee',
    },
  });

  const nextItems = Array.isArray(parsed.items) ? parsed.items : null;
  if (!nextItems || nextItems.length === 0) {
    throw new Error('Agent de validation: aucune ligne retournee.');
  }

  return {
    items: nextItems,
    notes: typeof parsed.notes === 'string' && parsed.notes.length > 0 ? parsed.notes : null,
    rawResponse: rawText,
  };
}

module.exports = {
  runValidationAgent,
};
