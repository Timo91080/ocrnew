const fs = require('fs');
const path = require('path');
const mapper = require('../src/routes/orders');

(async () => {
  try {
    const p = path.join(__dirname, '..', 'public', 'bon -commande.json');
    const raw = fs.readFileSync(p, 'utf8');
  console.log('raw length:', raw.length);
  console.log('raw tail:', raw.slice(-200));
  const errPos = 9600;
  console.log('around pos', errPos, '->', raw.slice(errPos - 80, errPos + 80));
  const parsed = JSON.parse(raw);
    const res = mapper.mapBonToItems(parsed);
    console.log('Mapped items:', JSON.stringify(res.items, null, 2));
    console.log('Detected OCR sample (first 300 chars):', (res.ocrText || '').slice(0,300));
  } catch (e) {
    console.error('Error running test-map:', e);
    process.exit(1);
  }
})();