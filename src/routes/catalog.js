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
      enrichProductComplements(normalizeProduct(product, category))
    ),
  }));
}

function toPriceNumber(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildDefaultExtraProducts(productId) {
  return [
    { id: `${productId}-extra-queijo`, description: 'Queijo Extra', price: '2.50' },
    { id: `${productId}-extra-bacon`, description: 'Bacon Crocante', price: '3.90' },
    { id: `${productId}-extra-molho`, description: 'Molho Especial', price: '1.70' },
  ];
}

function enrichProductComplements(product) {
  const existingCompositions = Array.isArray(product.compositions)
    ? product.compositions.map((entry) => ({ ...entry }))
    : [];
  const existingExtras = existingCompositions.filter(
    (entry) => normalizeText(entry.type).toUpperCase() === 'EXTRA'
  );

  const defaults = buildDefaultExtraProducts(product.id);
  const extraById = new Map();

  for (const composition of existingExtras) {
    const baseProduct = composition.product && typeof composition.product === 'object'
      ? composition.product
      : {};
    const optionId = normalizeText(baseProduct.id || composition.id);
    if (!optionId) continue;
    extraById.set(optionId, {
      id: optionId,
      description: normalizeText(baseProduct.description) || 'Complemento',
      price: toPriceNumber(baseProduct.price).toFixed(2),
    });
  }

  for (const fallbackExtra of defaults) {
    if (!extraById.has(fallbackExtra.id)) {
      extraById.set(fallbackExtra.id, fallbackExtra);
    }
  }

  const normalizedExtras = Array.from(extraById.values()).map((extra, index) => ({
    id: `comp-${product.id}-${index + 1}`,
    type: 'EXTRA',
    product: {
      id: extra.id,
      description: extra.description,
      price: extra.price,
      image_url: product.image_url,
      image_crc32: null,
      compositions: [],
      combinations: [],
    },
  }));

  const existingCombinations = Array.isArray(product.combinations)
    ? product.combinations.map((entry) => ({ ...entry }))
    : [];
  const validCombinations = existingCombinations.filter(
    (entry) => Array.isArray(entry.children) && entry.children.length > 0
  );

  const fallbackCombination = {
    id: `comb-${product.id}-default`,
    description: 'Escolha o acompanhamento',
    priceRule: 'FIXED',
    minQuantity: 1,
    maxQuantity: 2,
    children: [
      {
        id: `comb-${product.id}-default-a`,
        description: 'Batata Pequena',
        priceRule: 'FIXED',
        price: '4.90',
        minQuantity: 0,
        maxQuantity: 2,
        children: [],
      },
      {
        id: `comb-${product.id}-default-b`,
        description: 'Nuggets 4un',
        priceRule: 'FIXED',
        price: '6.50',
        minQuantity: 0,
        maxQuantity: 2,
        children: [],
      },
      {
        id: `comb-${product.id}-default-c`,
        description: 'Molho Premium',
        priceRule: 'FIXED',
        price: '2.50',
        minQuantity: 0,
        maxQuantity: 2,
        children: [],
      },
    ],
  };

  const combinations = validCombinations.length > 0 ? validCombinations : [fallbackCombination];

  return {
    ...product,
    compositions: normalizedExtras,
    combinations,
  };
}

function buildOptionGroupsForProduct(product) {
  const groups = [];

  for (const combo of product.combinations || []) {
    const options = Array.isArray(combo.children)
      ? combo.children
          .filter((child) => normalizeText(child.id) && normalizeText(child.description))
          .map((child, index) => ({
            id: normalizeText(child.id),
            index,
            name: normalizeText(child.description),
            description: normalizeText(child.description),
            status: 'AVAILABLE',
            price: {
              value: toPriceNumber(child.price),
              currency: 'BRL',
            },
          }))
      : [];

    if (options.length === 0) continue;

    groups.push({
      id: normalizeText(combo.id),
      index: groups.length,
      name: normalizeText(combo.description) || 'Escolha uma opcao',
      description: normalizeText(combo.description) || 'Escolha uma opcao',
      minPermitted: Number.isInteger(combo.minQuantity) ? combo.minQuantity : 0,
      maxPermitted: Number.isInteger(combo.maxQuantity) ? combo.maxQuantity : 1,
      options,
    });
  }

  const extras = (product.compositions || []).filter(
    (entry) => normalizeText(entry.type).toUpperCase() === 'EXTRA'
  );

  if (extras.length > 0) {
    groups.push({
      id: `extras-${product.id}`,
      index: groups.length,
      name: 'Complementos',
      description: 'Adicione complementos ao seu produto',
      minPermitted: 0,
      maxPermitted: extras.length,
      options: extras.map((entry, index) => {
        const extraProduct = entry.product && typeof entry.product === 'object'
          ? entry.product
          : {};
        return {
          id: normalizeText(extraProduct.id || `${product.id}-extra-${index + 1}`),
          index,
          name: normalizeText(extraProduct.description) || 'Complemento',
          description: normalizeText(extraProduct.description) || 'Complemento',
          status: 'AVAILABLE',
          price: {
            value: toPriceNumber(extraProduct.price),
            currency: 'BRL',
          },
        };
      }),
    });
  }

  return groups;
}

function buildMerchantOpenDelivery(catalog) {
  const categories = [];
  const itemOffers = [];
  const items = [];
  const optionGroups = [];

  for (const category of catalog) {
    const offerIds = [];

    for (const product of category.products || []) {
      const offerId = `offer-${product.id}`;
      offerIds.push(offerId);

      const productOptionGroups = buildOptionGroupsForProduct(product);
      for (const group of productOptionGroups) {
        optionGroups.push(group);
      }

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
        optionGroupsId: productOptionGroups.map((group) => group.id),
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
    optionGroups,
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
