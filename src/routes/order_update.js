'use strict';

const express = require('express');
const { authenticate, buildError } = require('../middlewares/auth');
const { saveOrder } = require('../services/orders_store');
const { broadcast } = require('../services/ws_manager');

const router = express.Router();

const ORDER_REQUIRED = [
  'id', 'type', 'displayId', 'createdAt', 'orderTiming',
  'preparationStartDateTime', 'merchant', 'items', 'total', 'payments',
];

/**
 * POST /v1/orderUpdate
 * Receives an order event from the Ordering Application.
 * Accepts only eventType = CREATED.
 */
router.post('/orderUpdate', authenticate(), (req, res) => {
  const body = req.body;

  if (!body || typeof body !== 'object') {
    return res
      .status(400)
      .json(buildError(req, 'INVALID_REQUEST', 'Body ou parâmetros malformados.', { reason: 'Missing or invalid JSON body' }));
  }

  // Required event fields
  const missingEvent = [];
  if (!body.eventId)   missingEvent.push('eventId');
  if (!body.eventType) missingEvent.push('eventType');
  if (!body.orderId)   missingEvent.push('orderId');
  if (!body.metadata)  missingEvent.push('metadata');

  if (missingEvent.length > 0) {
    return res
      .status(422)
      .json(buildError(req, 'VALIDATION_ERROR', 'Campos obrigatórios faltando ou inválidos.', { missing_fields: missingEvent }));
  }

  if (body.eventType !== 'CREATED') {
    return res
      .status(422)
      .json(buildError(req, 'VALIDATION_ERROR', 'Campos obrigatórios faltando ou inválidos.', { reason: 'eventType must be CREATED' }));
  }

  const order = body.metadata && body.metadata.order;
  if (!order || typeof order !== 'object') {
    return res
      .status(422)
      .json(buildError(req, 'VALIDATION_ERROR', 'Campos obrigatórios faltando ou inválidos.', { missing_fields: ['metadata.order'] }));
  }

  // Validate required Order fields
  const missingOrder = ORDER_REQUIRED.filter((f) => order[f] === undefined || order[f] === null);
  if (missingOrder.length > 0) {
    return res
      .status(422)
      .json(buildError(req, 'VALIDATION_ERROR', 'Campos obrigatórios faltando ou inválidos.', { missing_fields: missingOrder.map((f) => `metadata.order.${f}`) }));
  }

  saveOrder(order);

  // Push event to subscribed WebSocket sessions (skip wildcard tenant — no clear scope)
  if (req.apiKeyTenant !== '*') {
    broadcast(
      { tenantId: req.apiKeyTenant },
      {
        type: 'order_status_changed',
        order_id: body.orderId,
        status: 'CREATED',
        timestamp: new Date().toISOString(),
      }
    );
  }

  return res.status(202).json({
    status: 'ACCEPTED',
    orderId: body.orderId,
  });
});

module.exports = router;
