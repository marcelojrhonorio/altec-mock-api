'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

const { metaMiddleware } = require('./middlewares/meta');
const { errorHandler } = require('./middlewares/error_handler');

const configRoute = require('./routes/config');
const bootstrapRoute = require('./routes/bootstrap');
const catalogRoute = require('./routes/catalog');
const orderUpdateRoute = require('./routes/order_update');
const ordersRoute = require('./routes/orders');
const wsEmitRoute = require('./routes/ws_emit');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const { ALLOWED_ORIGINS } = require('./config');
const corsOptions = {
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'If-None-Match'],
  exposedHeaders: ['ETag', 'Cache-Control'],
};
app.use(cors(corsOptions));

// ── Static assets (public) ───────────────────────────────────────────────────
app.use(
  '/assets',
  express.static(path.join(__dirname, '../assets'), {
    etag: true,
    maxAge: '1h',
  })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  express.json()(req, res, (err) => {
    if (err) {
      // Malformed JSON body
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Body ou parâmetros malformados.',
          details: { reason: err.message },
          request_id: req.requestId || 'n/a',
          trace_id: req.traceId || 'n/a',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    next();
  });
});

// ── Meta (request_id / trace_id / timestamp) ─────────────────────────────────
app.use(metaMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/v1', configRoute);
app.use('/v1', bootstrapRoute);
app.use('/v1', catalogRoute);
app.use('/v1', orderUpdateRoute);
app.use('/v1', ordersRoute);
app.use('/v1', wsEmitRoute);

// ── Root info ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Altec Totem Mock API',
    version: '1.2.0',
    status: 'running',
    base_url: '/v1',
    auth: 'Authorization: ApiKey ksk_mock_altec_001',
    endpoints: [
      'GET  /v1/tenants/:tenantId/establishments/:establishmentId/kiosks/:kioskId/config',
      'POST /v1/kiosks/bootstrap',
      'GET  /v1/merchant',
      'GET  /v1/catalog',
      'GET  /v1/products/:id',
      'POST /v1/orderUpdate',
      'GET  /v1/orders/:orderId',
      'POST /v1/ws/emit  (mock trigger)',
      'WS   /v1/ws?api_key=<key>',
    ],
    docs: 'openapi.yaml',
  });
});

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Rota não encontrada.',
      details: { path: req.path },
      request_id: req.requestId,
      trace_id: req.traceId,
      timestamp: req.timestamp,
    },
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
