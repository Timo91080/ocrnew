const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// Import du router avec garde
let ordersRouter;
try {
  ordersRouter = require('./routes/orders');
  if (ordersRouter && typeof ordersRouter.default === 'function') {
    ordersRouter = ordersRouter.default;
  }
} catch (e) {
  console.error('[server] require("./routes/orders") a échoué:', e.message);
  ordersRouter = null;
}

if (!ordersRouter || typeof ordersRouter.use !== 'function') {
  console.error('[server] Export invalide pour ./routes/orders. Valeur =', ordersRouter);
  const r = express.Router();
  r.use((req, res) => res.status(500).json({ error: 'ordersRouter non chargé' }));
  ordersRouter = r;
}

// 1) API d’abord
app.use('/api/orders', ordersRouter);

// 2) 404 JSON pour toute route /api/* non matchée
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.originalUrl });
});

// 3) Error handler JSON
app.use((err, req, res, next) => {
  console.error('[Server error]', err);
  const status = err.status || 500;
  const message = err?.message || 'Internal Server Error';
  res.status(status).type('application/json').send({ error: message });
});

// 4) Statique ensuite
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// 5) Fallback SPA (hors /api)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
