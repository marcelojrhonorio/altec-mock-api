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

module.exports = router;
