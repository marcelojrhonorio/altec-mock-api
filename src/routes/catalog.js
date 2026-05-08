'use strict';

const path = require('path');
const express = require('express');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// Load static catalog once
const CATALOG_DATA = require(path.join(__dirname, '../../data/catalog.json'));

/**
 * GET /v1/catalog
 * Returns full Scalar Catalog API payload.
 */
router.get('/catalog', authenticate(), (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res.status(200).json(CATALOG_DATA);
});

/**
 * GET /v1/products/:id
 * Returns a single product by id, searched across all categories.
 */
router.get('/products/:id', authenticate(), (req, res) => {
  const { id } = req.params;
  for (const category of CATALOG_DATA) {
    const products = category.products || [];
    const product = products.find((p) => p.id === id);
    if (product) {
      return res.status(200).json({ success: true, data: { ...product, categoryId: category.id } });
    }
  }
  return res.status(404).json({ success: false, error: 'Product not found' });
});

module.exports = router;
