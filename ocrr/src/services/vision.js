let provider = (process.env.OCR_PROVIDER || 'google').toLowerCase();

let extractor;

switch (provider) {
  case 'azure':
    extractor = require('./azureVision');
    break;
  case 'google':
  default:
    extractor = require('./googleVision');
    break;
}

async function extractTextFromImage(buffer) {
  return extractor.extractTextFromImage(buffer);
}

module.exports = {
  extractTextFromImage,
};
