require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { extractTextFromImage } = require('../src/services/vision');
const { structurizeOrderLines } = require('../src/services/groq');

(async () => {
  try {
    const imgPath = path.join(__dirname, '..', 'public', 'sample-order.jpg');
    if (!fs.existsSync(imgPath)) {
      console.error('Image sample-order.jpg not found in public/. Please place the scanned JPG there and re-run.');
      process.exit(1);
    }
    const buf = fs.readFileSync(imgPath);
    console.log('Running Cloud Vision OCR (this requires valid credentials) ...');
    const text = await extractTextFromImage(buf);
    console.log('OCR text (first 500 chars):\n', text.slice(0,500));

    console.log('\nCalling Groq structurizer (may call remote API) ...');
    const structured = await structurizeOrderLines(text);
    console.log('\nStructured items:', structured.items);
    console.log('\nRaw response (model):', (structured.rawResponse || '').slice(0,500));
  } catch (err) {
    console.error('Test failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();