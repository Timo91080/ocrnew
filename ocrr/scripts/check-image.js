const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'public', 'sample-order.jpg');
try {
  const stats = fs.statSync(p);
  console.log('Path:', p);
  console.log('Size:', stats.size, 'bytes');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(Math.min(64, stats.size));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  console.log('First bytes (hex):', buf.slice(0, 16).toString('hex'));
  console.log('First bytes (ascii):', buf.slice(0, 16).toString('ascii'));
} catch (err) {
  console.error('Error checking image:', err.message || err);
  process.exit(1);
}
