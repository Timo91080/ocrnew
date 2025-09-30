require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ImageAnnotatorClient } = require('@google-cloud/vision');

(async () => {
  try {
    console.log('Using GOOGLE_APPLICATION_CREDENTIALS =', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    const client = new ImageAnnotatorClient();
    const imgPath = path.join(__dirname, '..', 'public', 'sample-order.jpg');
    if (!fs.existsSync(imgPath)) {
      console.error('Image not found:', imgPath);
      process.exit(1);
    }
    const img = fs.readFileSync(imgPath);
    console.log('Calling documentTextDetection... (this may take a few seconds)');
    const [result] = await client.documentTextDetection({ image: { content: img } });
    console.log('=== Vision result summary ===');
    console.log('Top-level keys:', Object.keys(result));
    console.log('fullTextAnnotation present:', !!result.fullTextAnnotation);
    if (result.fullTextAnnotation && result.fullTextAnnotation.text) {
      console.log('fullText length:', result.fullTextAnnotation.text.length);
      console.log('Preview (first 600 chars):\n', result.fullTextAnnotation.text.slice(0, 600));
    } else {
      console.warn('No fullTextAnnotation in result. Full result object:');
      console.dir(result, { depth: 2 });
    }
  } catch (err) {
    console.error('Vision test error (stack):', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();