const fs = require('fs');
const path = require('path');
const levenshtein = require('fast-levenshtein');

/* ========= ENV ========= */
function toBool(v, dflt = true) {
  if (v == null) return dflt;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

const VALID_REFERENCE_LENGTHS = (function () {
  // accepte 6,7,8,9 par défaut (peut être surchargé via .env)
  const raw = process.env.REFERENCE_LENGTHS || process.env.REFERENCE_LENGTH || '6,7,8,9';
  return String(raw)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
})();

const ENABLE_TEXT_DISCOVERY   = toBool(process.env.ENABLE_TEXT_DISCOVERY, true);
const MIN_COLOR_LENGTH        = Number(process.env.COLOR_MIN_LENGTH || 4);
const MIN_PRICE_VALUE         = Number(process.env.MIN_PRICE_VALUE  || 10);
const MAX_REFERENCE_DISTANCE  = Number(process.env.MAX_REFERENCE_DISTANCE || 1);
const MAX_MODEL_DISTANCE      = Number(process.env.MAX_MODEL_DISTANCE     || 2);
const MAX_QUANTITY            = Number(process.env.MAX_QUANTITY || 10);

/* ========= CACHES ========= */
let cachedCatalog = null;
let modelIndex = null;           // Map<normalizedModel, Entry[]>
let catalogByReference = null;   // Map<reference, Entry>

/* ========= UTILS ========= */
function isValidRefLen(n) { return VALID_REFERENCE_LENGTHS.includes(n); }

function stripDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normalizeReference(ref) {
  if (!ref) return null;
  return stripDiacritics(ref).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}
function normalizeKey(value) {
  if (!value) return null;
  return stripDiacritics(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
function normalizePrice(value) {
  if (value == null) return null;
  const n = parseFloat(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < MIN_PRICE_VALUE) return null;
  return n.toFixed(2);
}
function sanitizeQuantity(value) {
  const n = parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_QUANTITY) return '1';
  return String(n);
}
function ensureValidSize(value, fallback) {
  if (!value) return fallback || null;
  const cleaned = String(value).trim();
  if (/^code\s*10$/i.test(cleaned)) return 'code10';
  const alnum = cleaned.replace(/[^0-9A-Za-z/]/g, '').toUpperCase(); // garde "95BC", "38/40"
  if (alnum.length >= 2) return alnum;
  return fallback || null;
}
function splitReferenceAndSize(rawReference) {
  if (!rawReference) return { ref: null, size: null };
  const cleaned = stripDiacritics(rawReference).replace(/[^0-9A-Za-z]/g, '');
  for (const L of VALID_REFERENCE_LENGTHS) {
    if (cleaned.length === L + 2) return { ref: cleaned.slice(0, L), size: cleaned.slice(L) };
  }
  if (isValidRefLen(cleaned.length)) return { ref: cleaned, size: null };
  return { ref: null, size: null };
}

/* ========= CONFUSIONS OCR ========= */
const CONFUSABLE_MAP = {
  A: ['4'], B: ['8'], E: ['3'], G: ['6'], I: ['1','L'], L: ['1','I'], O: ['0'], S: ['5'], Z: ['2'],
  '0':['O'],'1':['I','L'],'2':['Z'],'3':['E'],'4':['A'],'5':['S'],'6':['G'],'8':['B'],
};
function generateConfusableVariants(ref) {
  const variants = new Set([ref]);
  for (let i = 0; i < ref.length; i++) {
    const ch = ref[i];
    const conf = CONFUSABLE_MAP[ch];
    if (!conf) continue;
    conf.forEach((alt) => variants.add(ref.slice(0, i) + alt + ref.slice(i + 1)));
  }
  return variants;
}

/* ========= CATALOG LOADER ========= */
function loadCatalog() {
  if (cachedCatalog) return cachedCatalog;

  const candidates = [
    path.resolve(process.cwd(), 'src/data/catalog.json'),
    path.resolve(process.cwd(), 'data/catalog.json'),
    path.join(__dirname, '..', '..', 'data', 'catalog.json'),
    path.join(__dirname, '..', 'data', 'catalog.json'),
  ];

  let filePath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { filePath = p; break; }
  }
  if (!filePath) {
    console.warn('[Catalog] catalog.json introuvable', candidates);
    cachedCatalog = [];
    modelIndex = new Map();
    catalogByReference = new Map();
    return cachedCatalog;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    cachedCatalog = parsed
      .map((it) => ({
        reference: normalizeReference(it.reference),
        model: it.model || null,
        color: it.color || null,
        size: it.size || null,
        price: it.price || null,
      }))
      .filter((it) => it.reference && isValidRefLen(it.reference.length));

    modelIndex = new Map();
    catalogByReference = new Map();
    for (const entry of cachedCatalog) {
      catalogByReference.set(entry.reference, entry);
      const key = normalizeKey(entry.model);
      if (!key) continue;
      if (!modelIndex.has(key)) modelIndex.set(key, []);
      modelIndex.get(key).push(entry);
    }

    // LOG: distribution des longueurs
    const dist = cachedCatalog.reduce((m, e) => {
      const L = e.reference.length;
      m[L] = (m[L] || 0) + 1;
      return m;
    }, {});
    console.log('[Catalog] Loaded', cachedCatalog.length, 'entries from', filePath,
      'Lengths=', VALID_REFERENCE_LENGTHS.join(','), 'Distribution=', dist);

  } catch (e) {
    cachedCatalog = [];
    modelIndex = new Map();
    catalogByReference = new Map();
    console.warn('[Catalog] parse error:', e.message);
  }
  return cachedCatalog;
}

/* ========= MATCH REF ========= */
function findCatalogByReference(ref) {
  if (!ref) return { entry: null, distance: Infinity };
  const normalized = normalizeReference(ref);
  if (!normalized) return { entry: null, distance: Infinity };

  loadCatalog();

  const exact = catalogByReference.get(normalized);
  if (exact) return { entry: exact, distance: 0 };

  const variants = generateConfusableVariants(normalized);
  for (const v of variants) {
    const hit = catalogByReference.get(v);
    if (hit) return { entry: hit, distance: 0.5 };
  }

  let bestEntry = null;
  let bestDistance = Infinity;
  for (const entry of cachedCatalog) {
    const d = levenshtein.get(normalized, entry.reference);
    if (d < bestDistance) { bestDistance = d; bestEntry = entry; }
    if (d === 0) break;
  }
  return bestDistance <= MAX_REFERENCE_DISTANCE
    ? { entry: bestEntry, distance: bestDistance }
    : { entry: null, distance: Infinity };
}

/* ========= MATCH MODELE ========= */
function findCatalogByModel(modelValue, colorValue, sizeValue) {
  if (!modelValue) return { entry: null, distance: Infinity };
  loadCatalog();
  const normalizedModel = normalizeKey(modelValue);
  if (!normalizedModel) return { entry: null, distance: Infinity };

  let candidates = modelIndex.get(normalizedModel);
  if (!candidates || candidates.length === 0) {
    let bestEntries = null;
    let bestD = Infinity;
    for (const [key, entries] of modelIndex.entries()) {
      const d = levenshtein.get(normalizedModel, key);
      if (d < bestD) { bestD = d; bestEntries = entries; }
    }
    if (bestD <= MAX_MODEL_DISTANCE) candidates = bestEntries;
  }
  if (!candidates || candidates.length === 0) return { entry: null, distance: Infinity };

  const normalizedColor = normalizeKey(colorValue);
  const normalizedSize  = sizeValue ? String(sizeValue).replace(/[^0-9A-Za-z]/g, '').toUpperCase() : null;

  let bestEntry = null;
  let bestScore = Infinity;
  for (const entry of candidates) {
    let score = 0;
    if (normalizedColor && normalizedColor.length >= MIN_COLOR_LENGTH) {
      const entryColorKey = normalizeKey(entry.color);
      const cd = entryColorKey ? levenshtein.get(normalizedColor, entryColorKey) : Infinity;
      if (cd > 1) score = Infinity; else score += cd;
    }
    if (score !== Infinity && normalizedSize && entry.size) {
      const entrySizeKey = String(entry.size).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      if (normalizedSize !== entrySizeKey) score += 1;
    }
    if (score < bestScore) { bestScore = score; bestEntry = entry; }
  }

  return bestEntry && bestScore !== Infinity
    ? { entry: bestEntry, distance: bestScore }
    : { entry: null, distance: Infinity };
}

/* ========= DÉCOUVERTE OCR : helpers ========= */
function longestDigitRun(s) {
  let best = '', cur = '';
  for (const ch of s) {
    if (/[0-9]/.test(ch)) { cur += ch; if (cur.length > best.length) best = cur; }
    else cur = '';
  }
  return best;
}
function hasAnchorInText(ref, normText) {
  const m = ref.match(/^(\d{6,})/);
  const anchor = m ? m[1].slice(0, 6) : longestDigitRun(ref);
  return anchor && anchor.length >= 5 && normText.includes(anchor);
}
function extractDigitAnchorsFromText(normText) {
  const anchors = new Set();
  let cur = '';
  for (const ch of normText) {
    if (/[0-9]/.test(ch)) cur += ch;
    else { if (cur.length >= 5) anchors.add(cur); cur = ''; }
  }
  if (cur.length >= 5) anchors.add(cur);
  return anchors;
}
function buildNormalizedText(text) {
  if (!text) return '';
  return stripDiacritics(text).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/* ========= DÉCOUVERTE OCR (5 passes + debug) ========= */
function findReferencesMentioned(text, dbg) {
  const found = new Set();
  if (!text) return found;
  loadCatalog();

  const norm = buildNormalizedText(text);
  const info = dbg || {};
  info.normLen = norm.length;
  info.anchors = Array.from(extractDigitAnchorsFromText(norm));
  info.traces = [];
  const trace = (pass, refs = []) => info.traces.push({ pass, count: refs.length, refs: refs.slice(0, 15) });

  /* PASS 1 : stricte (<=1) */
  const p1 = [];
  for (const entry of cachedCatalog) {
    const ref = entry.reference;
    if (norm.includes(ref)) { found.add(ref); p1.push(ref); continue; }

    const variants = generateConfusableVariants(ref);
    let ok = false;
    for (const v of variants) { if (norm.includes(v)) { ok = true; break; } }
    if (ok) { found.add(ref); p1.push(ref); continue; }

    const L = ref.length;
    let hit = false;
    for (let i = 0; i <= norm.length - (L - 1) && !hit; i++) {
      for (const w of [L - 1, L, L + 1]) {
        if (w <= 0 || i + w > norm.length) continue;
        if (levenshtein.get(norm.slice(i, i + w), ref) <= 1) { hit = true; break; }
      }
    }
    if (hit) { found.add(ref); p1.push(ref); }
  }
  if (p1.length) { trace('strict<=1', p1); return found; }
  trace('strict<=1', p1);

  /* PASS 2 : fallback (<=2) + ancre ref->texte */
  const p2 = [];
  for (const entry of cachedCatalog) {
    const ref = entry.reference;
    if (!hasAnchorInText(ref, norm)) continue;

    if (norm.includes(ref)) { found.add(ref); p2.push(ref); continue; }

    const variants = generateConfusableVariants(ref);
    let ok = false;
    for (const v of variants) { if (norm.includes(v)) { ok = true; break; } }
    if (ok) { found.add(ref); p2.push(ref); continue; }

    const L = ref.length;
    let hit = false;
    for (let i = 0; i <= norm.length - (L - 1) && !hit; i++) {
      for (const w of [L - 1, L, L + 1]) {
        if (w <= 0 || i + w > norm.length) continue;
        if (levenshtein.get(norm.slice(i, i + w), ref) <= 2) { hit = true; break; }
      }
    }
    if (hit) { found.add(ref); p2.push(ref); }
  }
  if (p2.length) { trace('fallback<=2+anchorRef', p2); return found; }
  trace('fallback<=2+anchorRef', p2);

  /* PASS 3 : fallback (<=2) guidée par préfixe numérique du texte */
  const p3 = [];
  const textAnchors = new Set(info.anchors);
  if (textAnchors.size) {
    for (const entry of cachedCatalog) {
      const ref = entry.reference;

      let matched = false;
      for (const prefLen of [7, 6, 5]) {
        if (ref.length < prefLen) continue;
        if (textAnchors.has(ref.slice(0, prefLen))) { matched = true; break; }
      }
      if (!matched) continue;

      if (norm.includes(ref)) { found.add(ref); p3.push(ref); continue; }

      const variants = generateConfusableVariants(ref);
      let ok = false;
      for (const v of variants) { if (norm.includes(v)) { ok = true; break; } }
      if (ok) { found.add(ref); p3.push(ref); continue; }

      const L = ref.length;
      let hit = false;
      for (let i = 0; i <= norm.length - (L - 1) && !hit; i++) {
        for (const w of [L - 1, L, L + 1]) {
          if (w <= 0 || i + w > norm.length) continue;
          if (levenshtein.get(norm.slice(i, i + w), ref) <= 2) { hit = true; break; }
        }
      }
      if (hit) { found.add(ref); p3.push(ref); }
    }
  }
  if (p3.length) { trace('fallback<=2+prefixFromText', p3); return found; }
  trace('fallback<=2+prefixFromText', p3);

  /* PASS 4 : tolérant — ancre du texte en substring dans la ref */
  const p4 = [];
  if (textAnchors.size) {
    const candidates = new Set();
    for (const entry of cachedCatalog) {
      const ref = entry.reference;
      for (const a of textAnchors) {
        if (ref.includes(a)) { candidates.add(ref); break; }
      }
    }
    for (const ref of candidates) {
      if (norm.includes(ref)) { found.add(ref); p4.push(ref); continue; }

      const variants = generateConfusableVariants(ref);
      let ok = false;
      for (const v of variants) { if (norm.includes(v)) { ok = true; break; } }
      if (ok) { found.add(ref); p4.push(ref); continue; }

      const L = ref.length;
      let hit = false;
      for (let i = 0; i <= norm.length - (L - 1) && !hit; i++) {
        for (const w of [L - 1, L, L + 1]) {
          if (w <= 0 || i + w > norm.length) continue;
          if (levenshtein.get(norm.slice(i, i + w), ref) <= 2) { hit = true; break; }
        }
      }
      if (hit) { found.add(ref); p4.push(ref); }
    }
  }
  trace('fallback<=2+substringFromText', p4);

  /* PASS 5 : secours (<=2) sans ancre – limité, pour cas très bruités */
  const p5 = [];
  let scanned = 0;
  const MAX_SCAN = 200;             // limite de sécu pour éviter le bruit
  for (const entry of cachedCatalog) {
    if (scanned >= MAX_SCAN) break;
    const ref = entry.reference;

    if (norm.includes(ref)) { found.add(ref); p5.push(ref); scanned++; continue; }

    let ok = false;
    for (const v of generateConfusableVariants(ref)) {
      if (norm.includes(v)) { ok = true; break; }
    }
    if (ok) { found.add(ref); p5.push(ref); scanned++; continue; }

    const L = ref.length;
    let hit = false;
    for (let i = 0; i <= norm.length - (L - 1) && !hit; i++) {
      for (const w of [L - 1, L, L + 1]) {
        if (w <= 0 || i + w > norm.length) continue;
        if (levenshtein.get(norm.slice(i, i + w), ref) <= 2) { hit = true; break; }
      }
    }
    if (hit) { found.add(ref); p5.push(ref); }
    scanned++;
  }
  trace('rescue<=2+limited', p5);

  return found;
}

function debugDiscovery(text) {
  const dbg = {};
  const refs = Array.from(findReferencesMentioned(text, dbg));
  dbg.found = refs;
  return dbg;
}

/* ========= RÉSOLUTION LIGNE ========= */
function resolveCatalogEntry(item) {
  const rawReference = item.reference_ocr || item.reference || item.reference_raw || '';
  const rawModel  = item.model_name_raw || item.model || '';
  const rawColor  = item.coloris_raw    || item.color || '';
  let size = item.size_or_code_raw ? String(item.size_or_code_raw).trim() : null;

  let reference = normalizeReference(rawReference);
  if (!reference || !isValidRefLen(reference.length)) {
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

/* ========= POST-PROCESS GLOBAL ========= */
function postProcessItems(items, options = {}) {
  if (!Array.isArray(items)) items = [];
  loadCatalog();

  const referencedInText = ENABLE_TEXT_DISCOVERY
    ? findReferencesMentioned(options.ocrText || '')
    : new Set();

  const results = [];
  const trackedSeen = new Set(); // ref|size|qty
  const seenRefSize = new Set(); // ref|size vus par LLM

  // 1) Lignes LLM confirmées par le catalogue
  for (const item of items) {
    const { entry, size, distance } = resolveCatalogEntry(item);
    if (!entry) continue;

    const reference = entry.reference;
    const finalSize = entry.size || null;
    const unit_price_raw = normalizePrice(entry.price);
    const quantity_raw   = sanitizeQuantity(item.quantity_raw);

    const refSizeKey = `${reference}|${finalSize || ''}`;
    seenRefSize.add(refSizeKey);

    const key = `${reference}|${finalSize || ''}|${quantity_raw || ''}`;
    if (trackedSeen.has(key)) continue;

    results.push({
      page: item.page || null,
      model_name_raw: entry.model || null,
      coloris_raw: entry.color || null,
      reference_ocr: reference,
      size_or_code_raw: finalSize,
      quantity_raw,
      unit_price_raw,
      needs_review: Boolean(distance > 0),
      __source_raw: item,
    });
    trackedSeen.add(key);
  }

  // 2) Découverte OCR -> seulement si (ref, taille) non couverts par LLM
  for (const reference of referencedInText) {
    const entry = catalogByReference.get(reference);
    if (!entry) continue;

    const refSizeKey = `${entry.reference}|${entry.size || ''}`;
    if (seenRefSize.has(refSizeKey)) continue;

    const key = `${entry.reference}|${entry.size || ''}|1`;
    if (trackedSeen.has(key)) continue;

    results.push({
      page: null,
      model_name_raw: entry.model || null,
      coloris_raw: entry.color || null,
      reference_ocr: entry.reference,
      size_or_code_raw: entry.size || null,
      quantity_raw: '1',
      unit_price_raw: normalizePrice(entry.price),
      needs_review: false,
      __source_raw: { discovered_from_ocr_text: true },
    });
    trackedSeen.add(key);
  }

  return results.sort((a, b) => {
    const A = a.reference_ocr || '';
    const B = b.reference_ocr || '';
    if (A === B) return 0;
    return A.localeCompare(B);
  });
}

/* ========= PROMPT SNIPPET ========= */
function getCatalogPromptSnippet(limit = 50) {
  loadCatalog();
  const items = cachedCatalog.slice(0, limit);
  return items
    .map((e) => `${e.reference}: ${e.model || ''} | ${e.color || ''} | ${e.size || ''} | ${e.price || ''}`)
    .join('\n');
}

module.exports = {
  normalizeReference,
  postProcessItems,
  getCatalogPromptSnippet,
  debugDiscovery,
};
