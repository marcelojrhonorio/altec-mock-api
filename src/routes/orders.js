'use strict';

const path = require('path');
const express = require('express');
const { authenticate, buildError } = require('../middlewares/auth');
const { findOrder } = require('../services/orders_store');

const router = express.Router();

// Static orders loaded once at startup
const STATIC_ORDERS = require(path.join(__dirname, '../../data/orders_static.json'));
const staticOrdersMap = new Map(STATIC_ORDERS.map((o) => [o.id, o]));

/**
 * GET /v1/orders/:orderId
 * Returns order details. Dynamic store is queried first, static fallback second.
 */
router.get('/orders/:orderId', authenticate(), (req, res) => {
  const { orderId } = req.params;

  const order = findOrder(orderId) || staticOrdersMap.get(orderId);

  if (!order) {
    return res
      .status(404)
      .json(
        buildError(req, 'ORDER_NOT_FOUND', 'Pedido não encontrado.', { order_id: orderId })
      );
  }

  return res.status(200).json(order);
});

module.exports = router;
