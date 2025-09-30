require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { extractTextFromImage } = require('../src/services/vision');
const { structurizeOrderLines } = require('../src/services/groq');
const { sendItemsToSheetsWithValidation } = require('../src/services/exporter');

(async () => {
  try {
    const imgPath = path.join(__dirname, '..', 'public', 'sample-order.jpg');
    if (!fs.existsSync(imgPath)) {
      throw new Error('Image introuvable: ' + imgPath);
    }

    console.log('1) OCR Google Vision ...');
    const text = await extractTextFromImage(fs.readFileSync(imgPath));
    console.log('Texte OCR (200 premiers caracteres):\n', text.slice(0, 200));

    console.log('\n2) Structuration via Groq ...');
    const structured = await structurizeOrderLines(text);
    console.log('Items detectes:', structured.items);

    if (!structured.items || structured.items.length === 0) {
      throw new Error('Aucun item detecte. Abort export.');
    }

    console.log('\n3) Envoi vers Google Sheets (avec validation agent)...');
    const submission = await sendItemsToSheetsWithValidation({ items: structured.items, ocrText: text });
    console.log('Export reussi:', submission.result);
    console.log('Tentatives:', submission.attempts);
    if (submission.history && submission.history.length) {
      console.log('Historique des tentatives:');
      submission.history.forEach((entry) => {
        console.log(' - Tentative ' + entry.attempt + ': ' + entry.error);
        if (entry.agentApplied) {
          console.log('   -> Agent IA applique');
          if (entry.agentNotes) {
            console.log('      Notes: ' + entry.agentNotes);
          }
        }
        if (entry.agentError) {
          console.log('   -> Agent erreur: ' + entry.agentError);
        }
      });
    }
  } catch (error) {
    console.error('Pipeline failure:', error && error.message ? error.message : error);
    if (error.history) {
      console.error('Historique:');
      console.error(JSON.stringify(error.history, null, 2));
    }
    process.exit(1);
  }
})();
