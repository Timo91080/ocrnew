// Service OCR unifié (Azure + Google) avec support PDF natif + raster fallback
// ENV utilisables:
//   OCR_PROVIDER=azure|google (par défaut google)
//   FORCE_PDF_RASTER=1 force la rasterisation (ignore texte natif pdf-parse)
//   PDF_DPI=300 résolution de conversion PDF -> PNG
//   AZURE_VISION_ENDPOINT=...  AZURE_VISION_KEY=...
//   GOOGLE_APPLICATION_CREDENTIALS=./secrets/vision-credentials.json
//   OCR_DEBUG=1 pour logs détaillés
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

let pdfParse = null;
try { pdfParse = require('pdf-parse'); } catch (_) { /* pas installé => raster */ }

// ------------------ OCR providers ------------------
const PROVIDER = (process.env.OCR_PROVIDER || 'google').toLowerCase();

async function ocrGoogle(imagePath) {
  try {
    const { ImageAnnotatorClient } = require('@google-cloud/vision');
    const client = new ImageAnnotatorClient();
    const [result] = await client.documentTextDetection(imagePath);
    const fullText =
      result?.fullTextAnnotation?.text ||
      result?.textAnnotations?.[0]?.description ||
      '';
    return { who: 'google', ok: !!fullText, fullText, raw: result };
  } catch (e) {
    return { who: 'google', ok: false, fullText: '', error: e };
  }
}

async function ocrAzure(imagePath) {
  try {
    const { AzureKeyCredential } = require('@azure/core-auth');
    const { DocumentAnalysisClient } = require('@azure/ai-form-recognizer');
    const endpoint = process.env.AZURE_VISION_ENDPOINT;
    const key = process.env.AZURE_VISION_KEY;
    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    const buf = fs.readFileSync(imagePath);
    const poller = await client.beginAnalyzeDocument('prebuilt-read', buf);
    const { content } = await poller.pollUntilDone();
    const fullText = content || '';
    return { who: 'azure', ok: !!fullText, fullText, raw: content };
  } catch (e) {
    return { who: 'azure', ok: false, fullText: '', error: e };
  }
}

async function runOCROnImage(p, provider) {
  return provider === 'azure' ? ocrAzure(p) : ocrGoogle(p);
}
function otherProvider(p) { return p === 'azure' ? 'google' : 'azure'; }
function tooShort(t) { return (t ? t.length : 0) < 80; }

// ------------------ Sniff type (magic bytes) ------------------
function sniffFileType(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const b = Buffer.alloc(16);
  fs.readSync(fd, b, 0, 16, 0);
  fs.closeSync(fd);

  // PDF
  if (b.slice(0, 4).toString() === '%PDF') return 'pdf';
  // PNG
  if (b.readUInt32BE(0) === 0x89504e47) return 'png';
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  // WEBP (RIFF....WEBP)
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  // TIFF (II*\0 or MM\0*)
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return 'tiff';
  return 'unknown';
}

// ------------------ PDF helpers ------------------
async function extractTextFromPDF(pdfPath) {
  if (!pdfParse) return '';
  const data = fs.readFileSync(pdfPath);
  const parsed = await pdfParse(data);
  return parsed?.text || '';
}

function pdftoppmPath() { return process.env.PDFTOPPM_PATH || 'pdftoppm'; }

let _pdftoppmAvailable = null;
function isPdftoppmAvailable() {
  if (_pdftoppmAvailable !== null) return _pdftoppmAvailable;
  try {
    const spawnSync = require('child_process').spawnSync;
    const res = spawnSync(pdftoppmPath(), ['-h'], { windowsHide: true });
    _pdftoppmAvailable = res.status === 0 || String(res.stdout || '').toLowerCase().includes('pdftoppm');
  } catch (_) {
    _pdftoppmAvailable = false;
  }
  return _pdftoppmAvailable;
}

async function rasterizePdfToPngs(pdfPath, dpi = 300) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfimg-'));
  const outPrefix = path.join(outDir, 'page');
  await new Promise((resolve, reject) => {
    execFile(pdftoppmPath(), ['-png', '-r', String(dpi), pdfPath, outPrefix], { windowsHide: true },
      (err) => (err ? reject(err) : resolve()));
  });
  const files = fs.readdirSync(outDir)
    .filter(f => /^page-\d+\.png$/i.test(f))
    .sort((a,b) => parseInt(a.match(/-(\d+)\.png$/)[1],10) - parseInt(b.match(/-(\d+)\.png$/)[1],10))
    .map(f => path.join(outDir, f));
  return { outDir, files };
}

// ------------------ performOCR ------------------
/**
 * Retourne { fullText, pages[], providerUsed?, raw? }
 * - Supporte fichiers sans extension (multer) grâce au sniff.
 */
async function performOCR(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const pref = PROVIDER === 'azure' ? 'azure' : 'google';
  const kind = sniffFileType(filePath);

  // ===== Images =====
  if (['png','jpg','webp','tiff'].includes(kind)) {
    let run = await runOCROnImage(filePath, pref);
    if (tooShort(run.fullText)) {
      const run2 = await runOCROnImage(filePath, otherProvider(pref));
      if ((run2.fullText || '').length > (run.fullText || '').length) run = run2;
    }
    console.log('[OCR]', { type: 'image', providerChosen: pref, used: run.who, len: (run.fullText || '').length });
    return { fullText: run.fullText || '', providerUsed: run.who, raw: run.raw,
      pages: [{ index: 1, ocrText: run.fullText, imagePath: filePath }] };
  }

  // ===== PDF =====
  if (kind === 'pdf') {
    let nativeText = '';
    if (process.env.FORCE_PDF_RASTER !== '1') {
      try { nativeText = await extractTextFromPDF(filePath); } catch (_) {}
    }
    if (!nativeText || nativeText.trim().length < 50) {
      // Vérifie la dispo de pdftoppm pour rasterizer
      if (!isPdftoppmAvailable()) {
        console.warn('[OCR][warn] pdftoppm introuvable -> pas de raster. (Installe Poppler ou définis PDFTOPPM_PATH)');
        // Fallback opportuniste: tentative Google Vision directe sur PDF (peut réussir sur certains PDF simples)
        try {
          if (PROVIDER === 'google') {
            const { ImageAnnotatorClient } = require('@google-cloud/vision');
            const client = new ImageAnnotatorClient();
            const [res] = await client.documentTextDetection(filePath);
            const alt = res?.fullTextAnnotation?.text || '';
            if (alt.trim().length > 0) {
              console.log('[OCR]', { type: 'pdf-direct-google', len: alt.length });
              return { fullText: alt, pages: [{ index: 1, ocrText: alt }] };
            }
          }
        } catch (e) {
          console.warn('[OCR][warn] tentative Google PDF directe échouée:', e.message);
        }
        return { fullText: '', pages: [], warning: 'Raster indisponible (installer Poppler) et aucun texte natif trouvé.' };
      }
      const dpi = Number(process.env.PDF_DPI || 300);
      const { files } = await rasterizePdfToPngs(filePath, dpi);
      const pages = [];
      let full = '';
            const doPre = process.env.OCR_PREPROCESS === '1';
            let enhancer = null;
            if (doPre) {
              try { enhancer = require('./visionPreprocess'); } catch(_) { console.warn('[OCR][warn] OCR_PREPROCESS=1 mais visionPreprocess indisponible'); }
            }
      for (let i = 0; i < files.length; i++) {
              let workFile = files[i];
              if (enhancer && enhancer.enhanceForOCR) {
                try { workFile = await enhancer.enhanceForOCR(files[i]); } catch(e) { console.warn('[OCR][prep] fail', e.message); }
              }
              let run = await runOCROnImage(workFile, pref);
        if (tooShort(run.fullText)) {
                const run2 = await runOCROnImage(workFile, otherProvider(pref));
          if ((run2.fullText || '').length > (run.fullText || '').length) run = run2;
        }
              pages.push({ index: i + 1, ocrText: run.fullText, imagePath: workFile });
        if (run.fullText) full += '\n' + run.fullText;
      }
      console.log('[OCR]', { type: 'pdf-raster', pages: pages.length, providerChosen: pref, len: full.trim().length });
      if (!full.trim()) {
        console.warn('[OCR][warn] PDF rasterisé mais texte vide. Vérifier la qualité ou installer tesseract pour un fallback futur.');
      }
      return { fullText: full.trim(), pages };
    }
    console.log('[OCR]', { type: 'pdf-native', len: nativeText.length });
    return { fullText: nativeText, pages: [{ index: 1, nativeText }] };
  }

  // ===== Inconnu (fichier sans extension, mais pas reconnu) : OCR dual-provider =====
  let run = await runOCROnImage(filePath, pref);
  if (tooShort(run.fullText)) {
    const run2 = await runOCROnImage(filePath, otherProvider(pref));
    if ((run2.fullText || '').length > (run.fullText || '').length) run = run2;
  }
  console.log('[OCR]', { type: 'unknown-fallback', providerChosen: pref, used: run.who, len: (run.fullText || '').length });
  return { fullText: run.fullText || '', pages: [{ index: 1, ocrText: run.fullText, imagePath: filePath }] };
}

module.exports = { performOCR };
