const fs = require('fs');
const path = require('path');
const levenshtein = require('fast-levenshtein');

let cachedCatalog = null;
let modelIndex = null;
let catalogByReference = null;

const MIN_COLOR_LENGTH = Number(process.env.COLOR_MIN_LENGTH || 4);
const REFERENCE_LENGTH = Number(process.env.REFERENCE_LENGTH || 7);
const MIN_PRICE_VALUE = Number(process.env.MIN_PRICE_VALUE || 10);
const MAX_REFERENCE_DISTANCE = Number(process.env.MAX_REFERENCE_DISTANCE || 1);
const MAX_MODEL_DISTANCE = Number(process.env.MAX_MODEL_DISTANCE || 2);

const COLOR_NORMALIZATION = new Map([
  ['GRISANTHERAVE', 'Gris anthracite'],
  ['FUSHIA', 'Fushia'],
  ['FUCHSIA', 'Fushia'],
  ['ROUGEBORDEAUX', 'Bordeaux'],
  ['BLEUCHE', 'Bleaché'],
  ['BLEACHE', 'Bleaché'],
]);

const MODEL_NORMALIZATION = new Map([
  ['MCHAUSSON', 'Chausson'],
  ['HOSEBENISTE', 'Ebeniste'],
  ['HOSBENISTE', 'Ebeniste'],
  ['PAULIEPULL', 'Paulie Pull'],
]);

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeReference(ref) {
  if (!ref) return null;
  return stripDiacritics(ref)
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
}

function normalizeKey(value) {
  if (!value) return null;
  return stripDiacritics(value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

function loadCatalog() {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const filePath = path.join(__dirname, '..', '..', 'data', 'catalog.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    cachedCatalog = parsed
      .map((item) => ({
        reference: normalizeReference(item.reference),
        model: item.model || null,
        color: item.color || null,
        size: item.size || null,
        price: item.price || null,
      }))
      .filter((item) => item.reference && item.reference.length === REFERENCE_LENGTH);

    modelIndex = new Map();
    catalogByReference = new Map();

    cachedCatalog.forEach((entry) => {
      catalogByReference.set(entry.reference, entry);
      const key = normalizeKey(entry.model);
      if (!key) return;
      if (!modelIndex.has(key)) {
        modelIndex.set(key, []);
      }
      modelIndex.get(key).push(entry);
    });
  } catch (error) {
    cachedCatalog = [];
    modelIndex = new Map();
    catalogByReference = new Map();
    console.warn('[catalog] Unable to load catalog.json:', error.message);
  }

  return cachedCatalog;
}

function findCatalogByReference(ref) {
  if (!ref) return { entry: null, distance: Infinity };
  const normalized = normalizeReference(ref);
  if (!normalized) return { entry: null, distance: Infinity };

  loadCatalog();

  const exact = catalogByReference.get(normalized);
  if (exact) {
    return { entry: exact, distance: 0 };
  }

  let bestEntry = null;
  let bestDistance = Infinity;
  for (const entry of cachedCatalog) {
    const distance = levenshtein.get(normalized, entry.reference);
    if (distance < bestDistance) {
      bestEntry = entry;
      bestDistance = distance;
    }
    if (distance === 0) break;
  }

  return bestDistance <= MAX_REFERENCE_DISTANCE
    ? { entry: bestEntry, distance: bestDistance }
    : { entry: null, distance: Infinity };
}

function findCatalogByModel(modelValue, colorValue, sizeValue) {
  if (!modelValue) return { entry: null, distance: Infinity };
  loadCatalog();

  const normalizedModel = normalizeKey(modelValue);
  if (!normalizedModel) return { entry: null, distance: Infinity };

  let candidates = modelIndex.get(normalizedModel);

  if (!candidates || candidates.length === 0) {
    let bestKeyEntries = null;
    let bestDistance = Infinity;
    for (const [key, entries] of modelIndex.entries()) {
      const distance = levenshtein.get(normalizedModel, key);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKeyEntries = entries;
      }
    }
    if (bestDistance <= MAX_MODEL_DISTANCE) {
      candidates = bestKeyEntries;
    }
  }

  if (!candidates || candidates.length === 0) {
    return { entry: null, distance: Infinity };
  }

  const normalizedColor = normalizeKey(colorValue);
  const normalizedSize = sizeValue ? String(sizeValue).replace(/[^0-9A-Za-z]/g, '').toUpperCase() : null;

  let bestEntry = null;
  let bestScore = Infinity;

  candidates.forEach((entry) => {
    let score = 0;

    if (normalizedColor) {
      const entryColorKey = normalizeKey(entry.color);
      const colorDistance = entryColorKey ? levenshtein.get(normalizedColor, entryColorKey) : Infinity;
      if (colorDistance > 1) {
        score = Infinity;
      } else {
        score += colorDistance;
      }
    }

    if (score !== Infinity && normalizedSize && entry.size) {
      const entrySizeKey = String(entry.size).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      if (normalizedSize !== entrySizeKey) {
        score += 1;
      }
    }

    if (score < bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  });

  return bestEntry && bestScore !== Infinity
    ? { entry: bestEntry, distance: bestScore }
    : { entry: null, distance: Infinity };
}

function normalizeColor(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed.length < MIN_COLOR_LENGTH) return null;

  const key = normalizeKey(trimmed);
  if (COLOR_NORMALIZATION.has(key)) {
    return COLOR_NORMALIZATION.get(key);
  }
  return trimmed;
}

function normalizeModel(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const key = normalizeKey(trimmed);
  if (MODEL_NORMALIZATION.has(key)) {
    return MODEL_NORMALIZATION.get(key);
  }
  return trimmed;
}

function normalizePrice(value) {
  if (value == null) return null;
  const numeric = parseFloat(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric < MIN_PRICE_VALUE) return null;
  return numeric.toFixed(2);
}

function normalizeQuantity(value) {
  if (value == null) return '1';
  const numeric = parseInt(String(value).replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return '1';
  return String(numeric);
}

function ensureValidSize(value, fallback) {
  if (!value) return fallback || null;
  const cleaned = String(value).trim();
  if (/^code\s*10$/i.test(cleaned)) {
    return 'code10';
  }
  const digits = cleaned.replace(/[^0-9]/g, '');
  if (digits.length >= 2) {
    return digits;
  }
  return fallback || null;
}

function splitReferenceAndSize(rawReference) {
  if (!rawReference) return { ref: null, size: null };
  const cleaned = stripDiacritics(rawReference).replace(/[^0-9A-Za-z]/g, '');
  if (cleaned.length === REFERENCE_LENGTH + 2) {
    return { ref: cleaned.slice(0, REFERENCE_LENGTH), size: cleaned.slice(REFERENCE_LENGTH) };
  }
  if (cleaned.length === REFERENCE_LENGTH) {
    return { ref: cleaned, size: null };
  }
  return { ref: null, size: null };
}

function resolveCatalogEntry(item) {
  const rawReference = item.reference_ocr || item.reference || item.reference_raw || '';
  const rawModel = item.model_name_raw || item.model || '';
  const rawColor = item.coloris_raw || item.color || '';
  let size = item.size_or_code_raw ? String(item.size_or_code_raw).trim() : null;

  let reference = normalizeReference(rawReference);
  if (!reference || reference.length !== REFERENCE_LENGTH) {
    const split = splitReferenceAndSize(rawReference);
    if (split.ref) reference = split.ref;
    if (!size && split.size) size = split.size;
  }

  let { entry, distance } = findCatalogByReference(reference);
  if (entry) {
    size = ensureValidSize(size, entry.size);
    return { entry, size, distance };
  }

  const modelResult = findCatalogByModel(rawModel, rawColor, size);
  if (modelResult.entry) {
    size = ensureValidSize(size, modelResult.entry.size);
    return { entry: modelResult.entry, size, distance: modelResult.distance };
  }

  return { entry: null, size: null, distance: Infinity };
}

function buildNormalizedText(text) {
  if (!text) return '';
  return stripDiacritics(text).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function findReferencesMentioned(text) {
  const result = new Set();
  if (!text) {
    return result;
  }
  loadCatalog();
  const normalizedText = buildNormalizedText(text);
  cachedCatalog.forEach((entry) => {
    if (normalizedText.includes(entry.reference)) {
      result.add(entry.reference);
    }
  });
  return result;
}

function postProcessItems(items, options = {}) {
  if (!Array.isArray(items)) items = [];
  loadCatalog();

  // Keep original OCR text normalized for optional use
  const normalizedText = buildNormalizedText(options.ocrText || '');
  const referencedInText = findReferencesMentioned(options.ocrText || '');

  // We want to preserve every input line as an output row (don't silently collapse
  // multiple lines belonging to the same reference). However, when we add extra
  // rows discovered by scanning the OCR text (referencedInText), avoid adding an
  // exact duplicate of an already emitted row. Tracked by a fine-grained key.
  const results = [];
  const trackedSeen = new Set();

  const pushEntry = (sourceItem, entry, size, distance) => {
    const src = sourceItem || {};

    const reference = entry ? entry.reference : normalizeReference(src.reference_ocr || src.reference || src.reference_raw || '');
    const finalSize = ensureValidSize(size, entry && entry.size ? entry.size : src.size_or_code_raw);

    const unitPriceCatalog = entry ? normalizePrice(entry.price) : null;
    const unitPriceSource = normalizePrice(src.unit_price_raw) || null;
    const unit_price_raw = unitPriceSource || unitPriceCatalog || null;

    const quantity_raw = src.quantity_raw ? normalizeQuantity(src.quantity_raw) : '1';

    const priceMismatch = unitPriceCatalog && unitPriceSource && Math.abs(parseFloat(unitPriceCatalog) - parseFloat(unitPriceSource)) > 0.4;
    const qtyMismatch = src.quantity_raw && String(src.quantity_raw).trim() !== String(quantity_raw).trim();

    const key = `${reference || ''}|${finalSize || ''}|${quantity_raw || ''}|${unit_price_raw || ''}`;
    if (trackedSeen.has(key)) {
      return;
    }
    trackedSeen.add(key);

    const needs_review = !entry || distance > 0 || priceMismatch || qtyMismatch;

    const outputRow = {
      page: src.page || null,
      // If a catalog entry exists, replace the extracted fields with the
      // canonical catalog values so the output is normalized to the catalog.
      model_name_raw: entry && entry.model ? entry.model : (src.model_name_raw || null),
      coloris_raw: entry && entry.color ? entry.color : (src.coloris_raw || null),
      // Always surface the catalog reference if we resolved an entry.
      reference_ocr: (entry && entry.reference) ? entry.reference : (reference || null),
      size_or_code_raw: finalSize || null,
      quantity_raw: quantity_raw || '1',
      // Prefer catalog price when an entry exists, otherwise keep source price if provided.
      unit_price_raw: (entry && entry.price) ? normalizePrice(entry.price) : (unit_price_raw || null),
      needs_review: Boolean(needs_review),
      __source_raw: src,
    };

    // If we resolved a catalog entry and the source contained differing values,
    // also keep the original extracted line so the user can compare and revert
    // if needed. Mark it with __extracted_original = true.
    results.push(outputRow);

    if (entry) {
      const originalRow = Object.assign({}, outputRow);
      originalRow.__extracted_original = true;
      // prefer keeping the raw extracted strings for the original row
      originalRow.model_name_raw = src.model_name_raw || originalRow.model_name_raw;
      originalRow.coloris_raw = src.coloris_raw || originalRow.coloris_raw;
      originalRow.reference_ocr = src.reference_ocr || originalRow.reference_ocr;
      originalRow.size_or_code_raw = src.size_or_code_raw || originalRow.size_or_code_raw;
      originalRow.unit_price_raw = src.unit_price_raw || originalRow.unit_price_raw;
      originalRow.quantity_raw = src.quantity_raw || originalRow.quantity_raw;
      results.push(originalRow);
    }
  };

  // Convert each input line to an output row, preserving multiplicity.
  items.forEach((item) => {
    const { entry, size, distance } = resolveCatalogEntry(item);
    pushEntry(item, entry, size, distance);
  });

  // Also ensure any references mentioned in the OCR text but not present in the
  // parsed lines are added (for discovery). The trackedSeen key prevents exact
  // duplicate insertion.
  referencedInText.forEach((reference) => {
    const entry = catalogByReference.get(reference);
    if (!entry) return;
    // push with a synthetic source item so __source_raw exists but indicates it was discovered
    const synthetic = { page: null, reference_ocr: reference };
    pushEntry(synthetic, entry, entry.size, 0);
  });

  return results.sort((a, b) => {
    const A = a.reference_ocr || '';
    const B = b.reference_ocr || '';
    if (A === B) return 0;
    return A.localeCompare(B);
  });
}

function getCatalogPromptSnippet(limit = 50) {
  loadCatalog();
  const items = cachedCatalog.slice(0, limit);
  return items
    .map((entry) => `${entry.reference}: ${entry.model || ''} | ${entry.color || ''} | ${entry.size || ''} | ${entry.price || ''}`)
    .join('\n');
}

module.exports = {
  normalizeReference,
  postProcessItems,
  getCatalogPromptSnippet,
};
