const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const upload = multer({ dest: path.join(process.cwd(), 'uploads') });

/* services applicatifs */
const { performOCR } = require('../services/vision');
const { postProcessItems, debugDiscovery } = require('../services/catalog');

/* LLM (tolérant) */
let extractWithLLM = async () => [];
try {
  const groqSvc = require('../services/groq');
  extractWithLLM =
    groqSvc.extractWithLLM ||
    groqSvc.extract ||
    groqSvc.run ||
    groqSvc.process ||
    groqSvc.default ||
    extractWithLLM;
  if (typeof extractWithLLM !== 'function') extractWithLLM = async () => [];
} catch {}

/* Google Sheets (facultatif) */
let appendItemsToSheet = async () => ({});
let isGoogleSheetsEnabled = () => false;
try {
  const sheets = require('../services/googleSheets');
  appendItemsToSheet    = sheets.appendItemsToSheet    || appendItemsToSheet;
  isGoogleSheetsEnabled = sheets.isGoogleSheetsEnabled || isGoogleSheetsEnabled;
} catch {}

/* GET /api/orders/config */
router.get('/config', (req, res) => {
  res.json({
    googleSheetsEnabled: isGoogleSheetsEnabled(),
    googleSheetId: process.env.GOOGLE_SHEET_ID || null,
    validationMaxAttempts: Number(process.env.VALIDATION_MAX_ATTEMPTS || 3),
    debugDiscovery: !!process.env.DEBUG_DISCOVERY
  });
});

/* POST /api/orders/process */
router.post('/process', upload.single('file'), async (req, res, next) => {
  try {
    const filePath = req.file?.path || req.body?.filePath;
    if (!filePath) return res.status(400).json({ error: 'file manquant' });

    const { fullText } = await performOCR(filePath);
    const llmItems = await extractWithLLM({ imagePath: filePath, ocrText: fullText });
    const finalItems = postProcessItems(llmItems || [], { ocrText: fullText });

    if (req.file?.path) fs.unlink(req.file.path, () => {});
    const payload = { ok: true, items: finalItems, ocrText: fullText };

    if (process.env.DEBUG_DISCOVERY) {
      payload.debug = {
        ocrLen: (fullText || '').length,
        discovery: debugDiscovery(fullText),
      };
    }

    res.json(payload);
  } catch (e) {
    next(e);
  }
});

/* POST /api/orders/send-to-sheets */
router.post('/send-to-sheets', async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'Aucun article à envoyer' });
    if (!isGoogleSheetsEnabled()) return res.status(400).json({ error: 'Google Sheets desactivé' });

    const result = await appendItemsToSheet(items);
    res.json({
      ok: true,
      attempts: 1,
      history: [],
      sheetUrl: process.env.GOOGLE_SHEET_ID
        ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`
        : null,
      result,
      items,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
