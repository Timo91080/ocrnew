const { Readable } = require('stream');
const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');

let cachedClient = null;

function getAzureClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const endpoint = process.env.AZURE_VISION_ENDPOINT;
  const key = process.env.AZURE_VISION_KEY;

  if (!endpoint || !key) {
    throw new Error('AZURE_VISION_ENDPOINT et AZURE_VISION_KEY doivent etre definis pour utiliser Azure Vision.');
  }

  cachedClient = new ComputerVisionClient(
    new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': key } }),
    endpoint
  );

  return cachedClient;
}

function createStream(buffer) {
  const stream = new Readable({ read() {} });
  stream.push(buffer);
  stream.push(null);
  return stream;
}

async function extractTextFromImage(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Aucun contenu image a analyser.');
  }

  const client = getAzureClient();
  const readOperation = await client.readInStream(() => createStream(buffer));

  if (!readOperation || !readOperation.operationLocation) {
    throw new Error('Azure Vision: operationLocation introuvable.');
  }

  const operationId = readOperation.operationLocation.split('/').pop();
  let readResult;
  let attempts = 0;

  do {
    attempts += 1;
    readResult = await client.getReadResult(operationId);
    if (readResult.status === 'succeeded' || readResult.status === 'failed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (attempts < 30);

  if (!readResult || readResult.status !== 'succeeded') {
    throw new Error(`Azure Vision OCR failed: ${readResult?.status || 'inconnu'}`);
  }

  const text = readResult.analyzeResult.readResults
    .map((page) => page.lines.map((line) => line.text).join('\n'))
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Azure Vision n\'a retourne aucun texte.');
  }

  return text;
}

module.exports = {
  extractTextFromImage,
};
