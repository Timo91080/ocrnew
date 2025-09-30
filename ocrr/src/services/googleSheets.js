const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

let sheetsClientPromise = null;

function isTruthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());
}

function isGoogleSheetsEnabled() {
  return isTruthy(process.env.ENABLE_GOOGLE_SHEETS);
}

// --- Normalisations robustes pour les clés PEM en .env ---
function normalizePem(raw) {
  if (!raw) return raw;
  let s = String(raw).trim().replace(/^"(.*)"$/s, '$1'); // retire des guillemets globaux s'ils existent
  s = s.replace(/\r\n/g, '\n');  // CRLF -> LF
  s = s.replace(/\\n/g, '\n');   // transforme \n littéraux en vrais retours
  return s;
}

function debugPem(key) {
  try {
    const lines = String(key || '').split('\n').filter(Boolean);
    const head = lines[0] || '';
    const tail = lines[lines.length - 1] || '';
    console.log('[Sheets PEM debug]', { lineCount: lines.length, head, tail });
  } catch {}
}

function loadJsonCredentials(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const txt = fs.readFileSync(resolved, 'utf8');
  const json = JSON.parse(txt);
  return { email: json.client_email, privateKey: json.private_key, filePath: resolved };
}

function getServiceAccountCredentials() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || null;
  if (keyFile) {
    const creds = loadJsonCredentials(keyFile);
    return { mode: 'keyFile', ...creds };
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && privateKeyRaw) {
    return { mode: 'env', email, privateKey: privateKeyRaw };
  }

  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac) {
    const creds = loadJsonCredentials(gac);
    return { mode: 'keyFile', ...creds };
  }

  throw new Error('Parametres Google Sheets manquants (fichier JSON OU email+private key).');
}

async function getSheetsClient() {
  if (!isGoogleSheetsEnabled()) throw new Error('Google Sheets est desactive.');
  if (!process.env.GOOGLE_SHEET_ID) throw new Error('GOOGLE_SHEET_ID manquant.');

  if (!sheetsClientPromise) {
    const creds = getServiceAccountCredentials();
    let auth;

    if (creds.mode === 'keyFile') {
      console.log('[Sheets] Auth via JSON file ->', creds.filePath);
      auth = new google.auth.JWT({
        email: creds.email,
        keyFile: creds.filePath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      const key = normalizePem(creds.privateKey);
      debugPem(key); // DEBUG utile : head/tail/lineCount
      if (!/BEGIN PRIVATE KEY/.test(key)) {
        throw new Error('Cle privee Google invalide: en-tete PEM manquant.');
      }
      console.log('[Sheets] Auth via env PEM for', (creds.email || '').split('@')[0] + '@...');
      auth = new google.auth.JWT({
        email: creds.email,
        key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }

    sheetsClientPromise = auth
      .authorize()
      .then(() => google.sheets({ version: 'v4', auth }))
      .catch((e) => {
        console.error('[Sheets auth error]', e?.response?.data || e?.message || e);
        throw e;
      });
  }

  return sheetsClientPromise;
}

function mapItemToRow(item) {
  const s = (v) => (v === undefined || v === null || v === '' ? null : String(v));
  return [

    s(item.model_name_raw),
    s(item.coloris_raw),
    s(item.reference_ocr),
    s(item.size_or_code_raw),
    s(item.quantity_raw),
    s(item.unit_price_raw),
   
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

  try {
    const resp = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
    return {
      updatedRange: resp.data?.updates?.updatedRange,
      updatedRows: resp.data?.updates?.updatedRows,
    };
  } catch (e) {
    console.error('[Sheets append error]', e?.response?.data || e?.message || e);
    throw e;
  }
}

module.exports = { appendItemsToSheet, isGoogleSheetsEnabled };
