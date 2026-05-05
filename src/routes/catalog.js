'use strict';

const path = require('path');
const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { generateETag, isNotModified } = require('../services/etag');

const router = express.Router();

// Load static catalog once — deterministic ETag computed at startup
const CATALOG_DATA = require(path.join(__dirname, '../../data/catalog.json'));
const CATALOG_ETAG = generateETag('catalog', CATALOG_DATA);

/**
 * GET /v1/catalog
 * Returns full Scalar Catalog API payload.
 * Supports ETag / If-None-Match → 304.
 */
router.get('/catalog', authenticate(), (req, res) => {
  const ifNoneMatch = req.headers['if-none-match'];

  if (isNotModified(ifNoneMatch, CATALOG_ETAG)) {
    return res.status(304).end();
  }

  res.set('ETag', CATALOG_ETAG);
  res.set('Cache-Control', 'private, max-age=300, stale-if-error=86400');
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
