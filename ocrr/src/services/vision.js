const fs = require('fs');

const PROVIDER = (process.env.OCR_PROVIDER || 'google').toLowerCase();

/* ---------------- Google Vision ---------------- */
async function ocrGoogle(imagePath) {
  try {
    const { ImageAnnotatorClient } = require('@google-cloud/vision');
    const client = new ImageAnnotatorClient();
    const [result] = await client.documentTextDetection(imagePath);
    const fullText =
      result?.fullTextAnnotation?.text ||
      result?.textAnnotations?.[0]?.description ||
      '';
    return { fullText, ok: !!fullText, who: 'google', raw: result };
  } catch (e) {
    return { fullText: '', ok: false, who: 'google', error: e };
  }
}

/* ---------------- Azure Read ---------------- */
async function ocrAzure(imagePath) {
  try {
    const { AzureKeyCredential } = require('@azure/core-auth');
    const { DocumentAnalysisClient } = require('@azure/ai-form-recognizer');
    const endpoint = process.env.AZURE_VISION_ENDPOINT;
    const key = process.env.AZURE_VISION_KEY;
    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    const img = fs.readFileSync(imagePath);
    const poller = await client.beginAnalyzeDocument('prebuilt-read', img);
    const { content } = await poller.pollUntilDone();
    const fullText = content || '';
    return { fullText, ok: !!fullText, who: 'azure', raw: content };
  } catch (e) {
    return { fullText: '', ok: false, who: 'azure', error: e };
  }
}

/**
 * OCR avec secours automatique:
 * - Essaie d’abord le provider choisi (OCR_PROVIDER).
 * - Si texte < 80 caractères, retente l’autre provider.
 * - Retourne le texte le plus long trouvé.
 */
async function performOCR(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`);

  const run1 = PROVIDER === 'azure' ? await ocrAzure(imagePath) : await ocrGoogle(imagePath);
  let best = run1;

  const tooShort = (t) => (t ? t.length : 0) < 80;

  if (tooShort(run1.fullText)) {
    const run2 = PROVIDER === 'azure' ? await ocrGoogle(imagePath) : await ocrAzure(imagePath);
    if ((run2.fullText || '').length > (best.fullText || '').length) best = run2;
  }

  console.log('[OCR]', { providerChosen: PROVIDER, used: best.who, len: (best.fullText || '').length });
  return { fullText: best.fullText || '', raw: best.raw, providerUsed: best.who };
}

module.exports = { performOCR };
