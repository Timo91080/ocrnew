const { callGroqJSON } = require('./groqClient');

function buildPrompt(ocrText) {
  return `Tu es un expert en extraction de donnees a partir de bons de commande scannes Afibel.\nTa tache est de lire le texte OCR fourni et d'extraire les lignes de commande de facon fiable.\n\nRegles importantes :\n- Lis uniquement les lignes contenant des produits commandes.\n- Ignore les messages publicitaires, informations hors commande ou mentions manuscrites non liees.\n- Pour chaque ligne produit, rends un objet avec les champs suivants :\n  - page : numero de page si detecte, sinon null\n  - model_name_raw : nom du modele tel qu'ecrit (corrige si lisible)\n  - coloris_raw : coloris tel qu'ecrit\n  - reference_ocr : reference produit telle qu'ecrite (ex: 313.9681 ou 444.1179A)\n  - size_or_code_raw : taille ou code (ex: 50/52, 38, code10)\n  - quantity_raw : quantite (en chiffre)\n  - unit_price_raw : prix unitaire avec point decimal (ex: 16.99)\n\nRegles de qualite :\n- Ne rien inventer. Si un champ est manquant ou illisible, mettre null.\n- Corrige les petites erreurs evidentes d'OCR (par ex: \\"5Q/52\\" -> \\"50/52\\", \\"313.968l\\" -> \\"313.9681\\").\n- Convertis toujours les prix avec un point decimal (ex: 16,99 -> 16.99).\n- Rends un JSON strict et valide avec le format suivant :\n\n{\n  \\\"items\\\": [\n    {\n      \\\"page\\\": int|null,\n      \\\"model_name_raw\\\": string|null,\n      \\\"coloris_raw\\\": string|null,\n      \\\"reference_ocr\\\": string|null,\n      \\\"size_or_code_raw\\\": string|null,\n      \\\"quantity_raw\\\": string|null,\n      \\\"unit_price_raw\\\": string|null\n    }\n  ]\n}\n\nTexte OCR a analyser :\n---\n${ocrText}\n---\nReponds uniquement avec le JSON demande, rien d'autre.`;
}

async function structurizeOrderLines(ocrText) {
  if (!ocrText || typeof ocrText !== 'string') {
    throw new Error('Texte OCR invalide.');
  }

  const { parsed, rawText } = await callGroqJSON({
    prompt: buildPrompt(ocrText),
    mockResult: {
      items: [
        {
          page: null,
          model_name_raw: 'Exemple modele',
          coloris_raw: 'Rose',
          reference_ocr: '000.0000',
          size_or_code_raw: 'M',
          quantity_raw: '1',
          unit_price_raw: '9.99',
        },
      ],
    },
  });

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return { items, rawResponse: rawText };
}

module.exports = {
  structurizeOrderLines,
};
