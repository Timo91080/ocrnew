const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

let sheetsClientPromise = null;

function decodeNewlines(value) {
  return value ? value.replace(/\\n/g, '\n') : value;
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function isGoogleSheetsEnabled() {
  return isTruthy(process.env.ENABLE_GOOGLE_SHEETS);
}

function loadCredentialsFromFile(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const content = fs.readFileSync(resolved, 'utf8');
    const json = JSON.parse(content);
    return {
      email: json.client_email,
      privateKey: json.private_key,
      filePath: resolved,
    };
  } catch (error) {
    throw new Error(`Impossible de lire le fichier de credentials Google Sheets (${filePath}): ${error.message}`);
  }
}

function getServiceAccountCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = decodeNewlines(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '');

  if (email && privateKey.includes('BEGIN PRIVATE KEY')) {
    return { email, privateKey };
  }

  const fallbackPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const fallback = loadCredentialsFromFile(fallbackPath);

  if (fallback && fallback.email && fallback.privateKey) {
    return { email: fallback.email, privateKey: fallback.privateKey, keyFile: fallback.filePath };
  }

  throw new Error('Parametres de service account Google Sheets manquants.');
}

async function getSheetsClient() {
  if (!isGoogleSheetsEnabled()) {
    throw new Error('Google Sheets est desactive.');
  }

  if (!process.env.GOOGLE_SHEET_ID) {
    throw new Error('GOOGLE_SHEET_ID manquant.');
  }

  if (!sheetsClientPromise) {
    const credentials = getServiceAccountCredentials();
    if (!credentials.privateKey || !credentials.privateKey.includes('BEGIN PRIVATE KEY')) {
      throw new Error('Cle privee Google Sheets invalide.');
    }

    // Support either passing the private key directly or the keyFile path
    let auth;
    if (credentials.keyFile) {
      console.log('Google Sheets: using keyFile auth ->', credentials.keyFile);
      auth = new google.auth.JWT({
        email: credentials.email,
        keyFile: credentials.keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      auth = new google.auth.JWT({
        email: credentials.email,
        key: decodeNewlines(credentials.privateKey),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }

    sheetsClientPromise = auth.authorize().then(() => google.sheets({ version: 'v4', auth }));
  }

  return sheetsClientPromise;
}

function mapItemToRow(item) {
  const safe = (value) => (value === undefined || value === null || value === '' ? null : String(value));
  return [
    safe(item.page),
    safe(item.model_name_raw),
    safe(item.coloris_raw),
    safe(item.reference_ocr),
    safe(item.size_or_code_raw),
    safe(item.quantity_raw),
    safe(item.unit_price_raw),
    new Date().toISOString(),
  ];
}

async function appendItemsToSheet(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Aucun article a envoyer vers Google Sheets.');
  }

  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Sheet1';

  const values = items.map(mapItemToRow);

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A2`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values,
    },
  });

  return {
    updatedRange: response.data?.updates?.updatedRange,
    updatedRows: response.data?.updates?.updatedRows,
  };
}

module.exports = {
  appendItemsToSheet,
  isGoogleSheetsEnabled,
};
