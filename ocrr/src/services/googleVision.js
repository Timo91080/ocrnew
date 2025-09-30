const { ImageAnnotatorClient } = require('@google-cloud/vision');

let cachedClient = null;

function decodeNewlines(value) {
  return value ? value.replace(/\\n/g, '\n') : value;
}

function parseVisionCredentials() {
  if (process.env.GOOGLE_VISION_CREDENTIALS_BASE64) {
    const decoded = Buffer.from(process.env.GOOGLE_VISION_CREDENTIALS_BASE64, 'base64').toString('utf8');
    const json = JSON.parse(decoded);
    if (json.private_key) {
      json.private_key = decodeNewlines(json.private_key);
    }
    return json;
  }

  if (process.env.GOOGLE_VISION_CREDENTIALS) {
    const json = JSON.parse(process.env.GOOGLE_VISION_CREDENTIALS);
    if (json.private_key) {
      json.private_key = decodeNewlines(json.private_key);
    }
    return json;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return null;
  }

  throw new Error('Identifiants Google Vision manquants. Renseignez GOOGLE_VISION_CREDENTIALS ou GOOGLE_APPLICATION_CREDENTIALS.');
}

function getVisionClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const credentials = parseVisionCredentials();
  if (credentials) {
    cachedClient = new ImageAnnotatorClient({ credentials });
  } else {
    cachedClient = new ImageAnnotatorClient();
  }

  return cachedClient;
}

async function extractTextFromImage(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Aucun contenu image a analyser.');
  }

  const client = getVisionClient();
  const [result] = await client.documentTextDetection({ image: { content: buffer } });
  const fullText = result?.fullTextAnnotation?.text?.trim();

  if (!fullText) {
    throw new Error('Impossible d\'extraire du texte avec Cloud Vision.');
  }

  return fullText;
}

module.exports = {
  extractTextFromImage,
};
