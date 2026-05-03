'use strict';

const express = require('express');
const { authenticate, buildError } = require('../middlewares/auth');
const { broadcast, sessionCount } = require('../services/ws_manager');

const router = express.Router();

/**
 * POST /v1/ws/emit
 *
 * Mock-only trigger endpoint — broadcasts a WebSocket event to connected sessions.
 * Useful for Postman and integration tests to simulate server-push events without
 * waiting for a real domain action (e.g. config_updated, catalog_invalidated).
 *
 * Body:
 *   event_type  {string}  required  — becomes the `type` field of the WS event
 *   target      {object}  optional  — scope of the broadcast:
 *                 tenant_id  {string}  → all sessions for that tenant
 *                 kiosk_key  {string}  → sessions subscribed to that specific kiosk
 *                 (omit both)         → all open sessions
 *   payload     {object}  optional  — extra fields merged into the event
 *
 * Response:
 *   200 { status: 'EMITTED', event_type, delivered_to: N, active_sessions: M }
 */
router.post('/ws/emit', authenticate(), (req, res) => {
  const body = req.body;

  if (!body || !body.event_type) {
    return res
      .status(422)
      .json(
        buildError(req, 'VALIDATION_ERROR', 'Campos obrigatórios faltando ou inválidos.', {
          missing_fields: ['event_type'],
        })
      );
  }

  const target = body.target || {};
  const scope = {};
  if (target.kiosk_key)  scope.kioskKey  = target.kiosk_key;
  else if (target.tenant_id) scope.tenantId = target.tenant_id;

  const event = {
    type: body.event_type,
    timestamp: new Date().toISOString(),
    ...(body.payload || {}),
  };

  const deliveredTo = broadcast(scope, event);

  return res.status(200).json({
    status: 'EMITTED',
    event_type: body.event_type,
    delivered_to: deliveredTo,
    active_sessions: sessionCount(),
  });
});

module.exports = router;
