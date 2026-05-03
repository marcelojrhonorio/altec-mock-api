'use strict';

const { randomBytes } = require('crypto');

/**
 * Attaches request_id, trace_id and timestamp to req for use in all handlers.
 */
function metaMiddleware(req, res, next) {
  req.requestId = 'req_' + randomBytes(4).toString('hex');
  req.traceId = 'trc_' + randomBytes(4).toString('hex');
  req.timestamp = new Date().toISOString();
  next();
}

module.exports = { metaMiddleware };
