const express = require('express');
const multer = require('multer');
const path = require('path');

const { extractTextFromImage } = require('../services/vision');
const { structurizeOrderLines } = require('../services/groq');
const { isGoogleSheetsEnabled } = require('../services/googleSheets');
const { sendItemsToSheetsWithValidation } = require('../services/exporter');
const { mapBonToItems } = require('../services/bonMapper');
const { postProcessItems } = require('../services/catalog');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024, // 12 MB limit for uploaded forms
  },
});

function isJsonFile(filename, mimetype) {
  if (!filename) return mimetype === 'application/json';
  return path.extname(filename).toLowerCase() === '.json' || mimetype === 'application/json';
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

router.get('/config', (req, res) => {
  res.json({
    googleSheetsEnabled: isGoogleSheetsEnabled(),
    googleSheetId: process.env.GOOGLE_SHEET_ID || null,
    validationAgentEnabled: toBoolean(process.env.ENABLE_VALIDATION_AGENT, true),
    validationMaxAttempts: Number(process.env.VALIDATION_MAX_ATTEMPTS || 3),
  });
});

router.post('/process', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier recu. Veuillez selectionner un scan ou un JSON.' });
    }

    let ocrText = null;
    let structured;

    if (isJsonFile(req.file.originalname, req.file.mimetype)) {
      try {
        const parsed = JSON.parse(req.file.buffer.toString('utf8'));
        const mapped = mapBonToItems(parsed);
        structured = {
          items: postProcessItems(mapped.items, { ocrText: mapped.ocrText }),
          rawResponse: mapped.rawResponse,
        };
        ocrText = mapped.ocrText || null;
      } catch (err) {
        return res.status(400).json({ error: 'Fichier JSON invalide ou non supporte.', details: err.message });
      }
    } else {
      ocrText = await extractTextFromImage(req.file.buffer);
      const raw = await structurizeOrderLines(ocrText);
      structured = {
        items: postProcessItems(raw.items, { ocrText }),
        rawResponse: raw.rawResponse,
      };
    }

    const sheetUrl = isGoogleSheetsEnabled() && process.env.GOOGLE_SHEET_ID
      ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`
      : null;

    const autoExportEnabled = isGoogleSheetsEnabled() && toBoolean(process.env.AUTO_EXPORT_ON_PROCESS, false);
    let sheetsResult = null;
    let sheetsError = null;

    if (autoExportEnabled) {
      try {
        sheetsResult = await sendItemsToSheetsWithValidation({ items: structured.items, ocrText });
      } catch (err) {
        sheetsError = err.message || 'Echec de l\'export Google Sheets.';
      }
    }

    res.json({
      ocrText,
      items: structured.items,
      rawResponse: structured.rawResponse,
      sheetUrl,
      sheetsResult,
      sheetsError,
    });
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: error.message || 'Erreur interne lors du traitement du document.' });
  }
});

router.post('/send-to-sheets', async (req, res) => {
  try {
    if (!isGoogleSheetsEnabled()) {
      return res.status(501).json({ error: 'Envoi Google Sheets desactive.' });
    }

    const { items, ocrText } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Liste d\'articles vide ou absente.' });
    }

    const submission = await sendItemsToSheetsWithValidation({ items, ocrText });

    res.json({
      ok: true,
      items: submission.items,
      result: submission.result,
      attempts: submission.attempts,
      history: submission.history,
      sheetUrl: process.env.GOOGLE_SHEET_ID
        ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`
        : null,
    });
  } catch (error) {
    console.error('Sheets error:', error);
    res.status(500).json({
      error: error.message || 'Erreur lors de l\'envoi vers Google Sheets.',
      history: error.history || null,
    });
  }
});

module.exports = router;
