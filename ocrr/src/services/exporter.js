const { appendItemsToSheet, isGoogleSheetsEnabled } = require('./googleSheets');
const { runValidationAgent } = require('./validator');
const { postProcessItems } = require('./catalog');

const MAX_QUANTITY = Number(process.env.MAX_QUANTITY || 10);

function isValidationAgentEnabled() {
  return !['0', 'false', 'no'].includes(String(process.env.ENABLE_VALIDATION_AGENT || '1').toLowerCase());
}

function getMaxValidationAttempts() {
  const raw = Number(process.env.VALIDATION_MAX_ATTEMPTS || 3);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 10) : 3;
}

function normaliseField(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return String(value);
}

function getPreflightIssues(items) {
  const issues = [];
  items.forEach((item, index) => {
    const row = index + 1;
    const reference = normaliseField(item?.reference_ocr);
    const quantity = normaliseField(item?.quantity_raw);
    const price = normaliseField(item?.unit_price_raw);

    if (!reference) {
      issues.push(`Ligne ${row}: reference_ocr manquante.`);
    }
    if (!quantity) {
      issues.push(`Ligne ${row}: quantity_raw manquante.`);
    } else {
      const numericQty = Number(quantity.replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(numericQty) || numericQty <= 0 || numericQty > MAX_QUANTITY) {
        issues.push(`Ligne ${row}: quantity_raw invalide (${quantity}).`);
      }
    }
    if (!price) {
      issues.push(`Ligne ${row}: unit_price_raw manquant.`);
    }
    if (item.needs_review) {
      issues.push(`Ligne ${row}: champs suspects (needs_review).`);
    }
  });
  return issues;
}

async function appendWithValidation(items) {
  return appendItemsToSheet(items);
}

async function sendItemsToSheetsWithValidation({ items, ocrText }) {
  if (!isGoogleSheetsEnabled()) {
    throw new Error('Google Sheets est desactive.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Aucun article a envoyer vers Google Sheets.');
  }

  const maxAttempts = getMaxValidationAttempts();
  const agentEnabled = isValidationAgentEnabled();
  let currentItems = postProcessItems(items, { ocrText });
  const history = [];
  let attempt = 0;

  while (attempt < maxAttempts) {
    const currentAttempt = attempt + 1;

    try {
      currentItems = postProcessItems(currentItems, { ocrText });
      const preflightIssues = getPreflightIssues(currentItems);
      if (preflightIssues.length > 0) {
        throw new Error(`Preflight validation failed: ${preflightIssues.join(' ')}`);
      }

      const result = await appendWithValidation(currentItems);
      return {
        result,
        items: currentItems,
        attempts: currentAttempt,
        history,
      };
    } catch (error) {
      const errorMessage = error.message || 'Erreur inconnue lors de l\'envoi.';
      const entry = {
        attempt: currentAttempt,
        error: errorMessage,
      };
      history.push(entry);

      if (!agentEnabled || currentAttempt >= maxAttempts) {
        const err = new Error(errorMessage);
        err.history = history;
        err.items = currentItems;
        throw err;
      }

      try {
        const validation = await runValidationAgent({
          items: currentItems,
          ocrText,
          apiErrorMessage: errorMessage,
          attempt: currentAttempt,
        });
        currentItems = postProcessItems(validation.items, { ocrText });
        entry.agentNotes = validation.notes || null;
        entry.agentApplied = true;
      } catch (agentError) {
        entry.agentApplied = false;
        entry.agentError = agentError.message || String(agentError);
        const err = new Error(agentError.message || 'Echec de l\'agent de validation.');
        err.history = history;
        err.items = currentItems;
        throw err;
      }
    }

    attempt += 1;
  }

  const err = new Error('Nombre maximum de tentatives atteint.');
  err.history = history;
  err.items = currentItems;
  throw err;
}

module.exports = {
  sendItemsToSheetsWithValidation,
  isValidationAgentEnabled,
  getPreflightIssues,
};
