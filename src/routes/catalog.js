'use strict';

const path = require('path');
const express = require('express');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// Load static catalog once
const CATALOG_DATA = require(path.join(__dirname, '../../data/catalog.json'));

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeProduct(product, category) {
  const title = normalizeText(
    product.name || product.title || product.description
  );

  const explicitDescription = normalizeText(
    product.long_description ||
      product.longDescription ||
      product.details ||
      product.subtitle
  );

  const categoryDescription = normalizeText(category.description);
  const fallbackDescription =
    explicitDescription ||
    (title && categoryDescription
      ? `${title} - ${categoryDescription}`
      : title);

  return {
    ...product,
    name: title,
    description: fallbackDescription,
  };
}

function normalizeCatalogData(catalog) {
  return catalog.map((category) => ({
    ...category,
    products: (category.products || []).map((product) =>
      normalizeProduct(product, category)
    ),
  }));
}

function buildMerchantOpenDelivery(catalog) {
  const categories = [];
  const itemOffers = [];
  const items = [];

  for (const category of catalog) {
    const offerIds = [];

    for (const product of category.products || []) {
      const offerId = `offer-${product.id}`;
      offerIds.push(offerId);

      itemOffers.push({
        id: offerId,
        index: itemOffers.length,
        itemId: product.id,
        active: true,
        price: {
          value: Number.parseFloat(product.price || 0) || 0,
          currency: 'BRL',
        },
        availabilityId: ['all-day'],
        optionGroupsId: (product.combinations || []).map((c) => c.id),
      });

      items.push({
        id: product.id,
        name: product.name,
        description: product.description,
        image: product.image_url ? [{ url: product.image_url }] : [],
        externalCode: product.id,
      });
    }

    categories.push({
      id: category.id,
      name: category.description,
      description: category.description,
      index: categories.length,
      itemOfferId: offerIds,
      availabilityId: ['all-day'],
      active: true,
    });
  }

  return {
    lastUpdate: new Date().toISOString(),
    TTL: 300,
    id: 'merchant-mock-altec',
    status: 'AVAILABLE',
    basicInfo: {
      name: 'Altec Mock Merchant',
    },
    categories,
    itemOffers,
    items,
    optionGroups: [],
    availabilities: [
      {
        id: 'all-day',
        description: 'Always available',
      },
    ],
  };
}

/**
 * GET /v1/catalog
 * Returns full Scalar Catalog API payload.
 */
router.get('/catalog', authenticate(), (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res.status(200).json(normalizeCatalogData(CATALOG_DATA));
});

/**
 * GET /v1/merchant
 * Returns an OpenDelivery-style payload with categories, itemOffers and items.
 */
router.get('/merchant', authenticate(), (req, res) => {
  const normalizedCatalog = normalizeCatalogData(CATALOG_DATA);
  return res.status(200).json(buildMerchantOpenDelivery(normalizedCatalog));
});

/**
 * GET /v1/products/:id
 * Returns a single product by id, searched across all categories.
 */
router.get('/products/:id', authenticate(), (req, res) => {
  const { id } = req.params;
  const normalizedCatalog = normalizeCatalogData(CATALOG_DATA);

  for (const category of normalizedCatalog) {
    const products = category.products || [];
    const product = products.find((p) => p.id === id);
    if (product) {
      return res.status(200).json({
        success: true,
        data: { ...product, categoryId: category.id },
      });
    }
  }
  return res.status(404).json({ success: false, error: 'Product not found' });
});

module.exports = router;
