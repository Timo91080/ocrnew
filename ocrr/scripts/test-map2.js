const mapper = require('../src/services/bonMapper');
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'sample-bon.json'), 'utf8');
const parsed = JSON.parse(raw);
const { items } = mapper.mapBonToItems(parsed);
console.log('Mapped', items.length, 'items');
for (const it of items) {
  console.log('-', it.order_id || '-', it.reference_ocr || '-', it.model_name_raw || '-', it.size_or_code_raw || '-', it.quantity_raw || '-', it.unit_price_raw || '-');
}
