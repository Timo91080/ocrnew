#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
// Charge .env à la racine du projet (ocrr/.env)
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch(_) {}

const envPath = process.env.PDFTOPPM_PATH || '';

function tryExec(cmd, args = ['-v']) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.error) return { ok: false, error: r.error.message };
    if (r.status !== 0) return { ok: false, code: r.status, stderr: r.stderr };
    return { ok: true, stdout: r.stdout.trim() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

console.log('--- Poppler / pdftoppm diagnostic ---');
console.log('Process cwd =', process.cwd());
console.log('Env PDFTOPPM_PATH =', envPath || '(non défini)');
if (envPath) {
  console.log('PDFTOPPM_PATH from env =', envPath);
  if (!fs.existsSync(envPath)) {
    console.log('❌ Path does not exist.');
  } else {
    const res = tryExec(envPath, ['-v']);
    if (res.ok) console.log('✅ Executed pdftoppm at env path. Output:\n', res.stdout);
    else console.log('❌ Failed executing env path:', res);
  }
} else {
  console.log('No PDFTOPPM_PATH specified in environment. Will try plain "pdftoppm" in PATH.');
}

// Si PDFTOPPM_PATH existe mais pdftoppm de PATH aussi souhaité, on teste les deux.
const resPath = tryExec('pdftoppm', ['-v']);
if (resPath.ok) {
  console.log('✅ pdftoppm accessible via PATH.');
  console.log(resPath.stdout);
} else {
  console.log('❌ pdftoppm not found in PATH.');
  console.log(resPath);
  console.log('\nSolutions:');
  console.log(' 1) Installer via choco (admin): choco install poppler -y');
  console.log(' 2) Télécharger binaire et définir PDFTOPPM_PATH dans .env');
  console.log(' 3) Ajouter le dossier bin de Poppler au PATH utilisateur.');
}
