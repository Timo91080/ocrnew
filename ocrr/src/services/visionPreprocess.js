const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * Améliore une image pour l'OCR (contraste + seuil).
 * Entrée: chemin source (PNG/JPG), sortie: chemin destination (généré si non fourni).
 */
async function enhanceForOCR(srcPath, dstPath = null) {
  dstPath = dstPath || buildOutPath(srcPath);
  const pipeline = sharp(srcPath)
    .grayscale()
    .normalise()
    .sharpen({ sigma: 1 })
    .linear(1.15, -10) // augmente léger contraste
    .threshold(165);   // binarisation (ajuster selon résultats)

  const buf = await pipeline.png().toBuffer();
  fs.writeFileSync(dstPath, buf);
  return dstPath;
}

function buildOutPath(p) {
  const dir = path.dirname(p);
  const base = path.basename(p, path.extname(p));
  return path.join(dir, base + '-prep.png');
}

module.exports = { enhanceForOCR };
