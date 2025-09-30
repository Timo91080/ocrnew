function normalizeKey(key) {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const FIELD_KEYSETS = {
  model: ['modele', 'model', 'designation', 'nommodel', 'nomduproduit'],
  color: ['coloris', 'couleur', 'color', 'couleurproduit'],
  reference: ['codifcat', 'reference', 'ref', 'sku', 'codeproduit', 'coderef'],
  size: ['taille', 'code', 'taillecode', 'size'],
  quantity: ['quantite', 'quantitecommande', 'quantity', 'qte'],
  price: ['pv', 'prix', 'prixunitaire', 'price', 'montant'],
};

function cleanString(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str.length === 0 ? null : str;
}

function cleanPrice(value) {
  const str = cleanString(value);
  if (!str) return null;
  const normalised = str.replace(/[^0-9,.-]/g, '').replace(',', '.');
  const num = parseFloat(normalised);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(2);
}

function cleanQuantity(value) {
  const str = cleanString(value);
  if (!str) return '1';
  const digits = str.replace(/[^0-9-]/g, '');
  const num = parseInt(digits, 10);
  return Number.isFinite(num) && num > 0 ? String(num) : '1';
}

function pickField(item, keyset) {
  if (!item || typeof item !== 'object') return null;
  const entries = Object.entries(item);
  for (const [key, value] of entries) {
    const normKey = normalizeKey(key);
    if (keyset.includes(normKey)) {
      return value;
    }
  }
  return null;
}

function extractItemsFromNode(node, collector) {
  if (Array.isArray(node)) {
    node.forEach((child) => extractItemsFromNode(child, collector));
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  if (Array.isArray(node.items)) {
    node.items.forEach((item) => collector(item, node));
  }

  Object.values(node).forEach((value) => {
    if (value && typeof value === 'object') {
      extractItemsFromNode(value, collector);
    }
  });
}

function mapBonToItems(data) {
  const items = [];
  let detectedOcrText = null;

  const possibleOcrFields = ['ocrtext', 'texteocr', 'ocr', 'rawtext', 'texte', 'text'];
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length > 40) {
        const normKey = normalizeKey(key);
        if (possibleOcrFields.includes(normKey)) {
          detectedOcrText = value;
          break;
        }
      }
    }
  }

  extractItemsFromNode(data, (item) => {
    const model = cleanString(pickField(item, FIELD_KEYSETS.model));
    const color = cleanString(pickField(item, FIELD_KEYSETS.color));
    const reference = cleanString(pickField(item, FIELD_KEYSETS.reference));
    const size = cleanString(pickField(item, FIELD_KEYSETS.size));
    const quantity = cleanQuantity(pickField(item, FIELD_KEYSETS.quantity));
    const price = cleanPrice(pickField(item, FIELD_KEYSETS.price));

    if (reference || model || color || size) {
      items.push({
        page: null,
        model_name_raw: model,
        coloris_raw: color,
        reference_ocr: reference,
        size_or_code_raw: size,
        quantity_raw: quantity,
        unit_price_raw: price,
      });
    }
  });

  return {
    items,
    ocrText: detectedOcrText,
    rawResponse: JSON.stringify(data, null, 2),
  };
}

module.exports = {
  mapBonToItems,
};
