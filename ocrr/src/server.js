const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const ordersRouter = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/api/orders', ordersRouter);

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Serve SPA fallback — use a RegExp (.*/ ) which is parsed as a raw RegExp and avoids
// path-to-regexp parameter parsing errors in some versions of express/path-to-regexp
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
