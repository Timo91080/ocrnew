const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const statusEl = document.getElementById('status');
const resultsSection = document.getElementById('results');
const tableContainer = document.getElementById('table-container');
const ocrTextEl = document.getElementById('ocr-text');
const llmJsonEl = document.getElementById('llm-json');
const sendSheetsBtn = document.getElementById('send-sheets');
const sheetLink = document.getElementById('sheet-link');
const historyDetails = document.getElementById('history-details');
const historyLogEl = document.getElementById('history-log');
const reviewNoteEl = document.getElementById('review-note');

let extractedItems = [];
let lastOcrText = '';
let sheetsEnabled = false;
let validationInfo = null;

async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return { data: JSON.parse(text), raw: text };
  } catch {
    return { data: null, raw: text };
  }
}

async function fetchConfig() {
  try {
    const response = await fetch('/api/orders/config');
    const { data, raw } = await parseJsonSafe(response);
    if (!response.ok || !data) {
      throw new Error(
        data?.error ||
        `Impossible de recuperer la configuration. (${response.status}) ${raw.slice(0, 200)}`
      );
    }
    sheetsEnabled = Boolean(data.googleSheetsEnabled);
    validationInfo = data;
    if (data.googleSheetId) {
      sheetLink.classList.remove('hidden');
      sheetLink.href = `https://docs.google.com/spreadsheets/d/${data.googleSheetId}`;
    }
    if (!sheetsEnabled) {
      sendSheetsBtn.textContent = 'Google Sheets desactive';
      sendSheetsBtn.disabled = true;
    }
  } catch (error) {
    console.warn(error);
    setStatus(error.message, true);
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message || '';
  statusEl.style.color = isError ? '#c0392b' : '#31537a';
}

function renderHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    historyDetails.classList.add('hidden');
    historyLogEl.textContent = '';
    return;
  }

  const lines = history.map((entry) => {
    const parts = [`Tentative ${entry.attempt}`, `Erreur: ${entry.error}`];
    if (entry.agentApplied) {
      parts.push('Agent IA applique');
      if (entry.agentNotes) parts.push(`Notes agent: ${entry.agentNotes}`);
    }
    if (entry.agentError) parts.push(`Agent erreur: ${entry.agentError}`);
    return parts.join('\n');
  });

  historyDetails.classList.remove('hidden');
  historyLogEl.textContent = lines.join('\n\n');
}

function renderTable(items) {
  if (!items || items.length === 0) {
    tableContainer.innerHTML = '<p>Aucune ligne detectee.</p>';
    reviewNoteEl.classList.add('hidden');
    reviewNoteEl.textContent = '';
    return;
  }

  const headers = ['Modele', 'Coloris', 'Reference', 'Taille / Code', 'Quantite', 'Prix unitaire'];

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach((header) => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let needsReviewCount = 0;

  items.forEach((item) => {
    const row = document.createElement('tr');
    if (item.__extracted_original) row.classList.add('extracted-original');
    if (item.needs_review) {
      row.classList.add('needs-review');
      needsReviewCount += 1;
    }
    const cells = [
      item.model_name_raw ?? '',
      item.coloris_raw ?? '',
      item.reference_ocr ?? '',
      item.size_or_code_raw ?? '',
      item.quantity_raw ?? '',
      item.unit_price_raw ?? '',
    ];
    cells.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  tableContainer.innerHTML = '';
  tableContainer.appendChild(table);

  if (needsReviewCount > 0) {
    reviewNoteEl.textContent =
      `${needsReviewCount} ligne(s) necessitent une validation manuelle. ` +
      `Les valeurs catalogue n'ont pas pu etre confirmees.`;
    reviewNoteEl.classList.remove('hidden');
  } else {
    reviewNoteEl.classList.add('hidden');
    reviewNoteEl.textContent = '';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!fileInput.files || fileInput.files.length === 0) {
    setStatus('Veuillez selectionner un fichier.');
    return;
  }

  try {
    setStatus('Analyse en cours...');
    sendSheetsBtn.disabled = true;
    resultsSection.classList.add('hidden');
    renderHistory([]);
    reviewNoteEl.classList.add('hidden');

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const response = await fetch('/api/orders/process', { method: 'POST', body: formData });
    const { data: payload, raw } = await parseJsonSafe(response);

    if (!response.ok || !payload) {
      throw new Error(
        payload?.error || `Erreur serveur (${response.status}). ${raw.slice(0, 300)}`
      );
    }

    extractedItems = payload.items || [];
    lastOcrText = payload.ocrText || '';
    renderTable(extractedItems);

    ocrTextEl.textContent = lastOcrText;

    try {
      const parsed = payload.rawResponse ? JSON.parse(payload.rawResponse) : payload.items;
      llmJsonEl.textContent = JSON.stringify(parsed, null, 2);
    } catch (jsonError) {
      llmJsonEl.textContent = payload.rawResponse || 'Reponse JSON indisponible.';
    }

    if (payload.sheetUrl) {
      sheetLink.href = payload.sheetUrl;
      sheetLink.classList.remove('hidden');
    }

    if (payload.sheetsResult && payload.sheetsResult.history) {
      renderHistory(payload.sheetsResult.history);
      setStatus(`Extraction + export automatique termines en ${payload.sheetsResult.attempts} tentative(s).`);
    } else {
      renderHistory([]);
      setStatus(`Extraction terminee. ${extractedItems.length} ligne(s) detectee(s).`);
    }

    if (payload.sheetsError) {
      setStatus(`Extraction OK mais export automatique en erreur: ${payload.sheetsError}`, true);
    }

    resultsSection.classList.remove('hidden');

    if (sheetsEnabled && extractedItems.length > 0) {
      sendSheetsBtn.disabled = false;
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

sendSheetsBtn.addEventListener('click', async () => {
  if (!sheetsEnabled) return;
  if (!extractedItems || extractedItems.length === 0) {
    setStatus('Aucune donnee a envoyer.', true);
    return;
  }

  try {
    sendSheetsBtn.disabled = true;
    setStatus('Envoi vers Google Sheets...');

    const response = await fetch('/api/orders/send-to-sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: extractedItems, ocrText: lastOcrText }),
    });

    const { data: payload, raw } = await parseJsonSafe(response);
    if (!response.ok || !payload) {
      renderHistory(payload?.history || []);
      throw new Error(payload?.error || `Erreur Sheets (${response.status}). ${raw.slice(0, 300)}`);
    }

    extractedItems = payload.items || extractedItems;
    renderTable(extractedItems);
    renderHistory(payload.history || []);

    const attempts = payload.attempts || 1;
    setStatus(`Export Google Sheets reussi en ${attempts} tentative(s).`);
    if (payload.sheetUrl) {
      sheetLink.href = payload.sheetUrl;
      sheetLink.classList.remove('hidden');
    }
  } catch (error) {
    sendSheetsBtn.disabled = false;
    setStatus(error.message, true);
  }
});

fetchConfig();
