'use strict';

/**
 * Global Express error handler.
 * Catches any error thrown or passed via next(err).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err.message || err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno inesperado.',
      details: {},
      request_id: req.requestId || 'n/a',
      trace_id: req.traceId || 'n/a',
      timestamp: req.timestamp || new Date().toISOString(),
    },
  });
}

module.exports = { errorHandler };
