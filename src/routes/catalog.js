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
      enrichProductComplements(normalizeProduct(product, category), category)
    ),
  }));
}

function toPriceNumber(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildItemPrice(value) {
  const amount = toPriceNumber(value);
  return {
    value: amount,
    originalValue: amount,
    currency: 'BRL',
  };
}

function buildServiceHours(timeRangeId) {
  return {
    id: `${timeRangeId}-hours`,
    weekHours: [
      {
        dayOfWeek: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
        timePeriods: {
          startTime: '00:00:00.000Z',
          endTime: '23:59:59.000Z',
        },
      },
    ],
  };
}

const MINIMUM_COMPLEMENTS_PER_PRODUCT = 15;
const MINIMUM_WITHOUT_OPTIONS_PER_PRODUCT = 4;

function getCategoryCustomizationProfile(category) {
  const description = normalizeText(category && category.description).toLowerCase();

  if (description.includes('bebida')) return 'DRINK';
  if (description.includes('acompanhamento')) return 'SIDE';
  if (description.includes('sobremesa')) return 'DESSERT';
  return 'SANDWICH';
}

function buildUniversalExtraProducts(productId) {
  return [
    { id: `${productId}-extra-queijo`, description: 'Queijo Extra', price: '2.50' },
    { id: `${productId}-extra-bacon`, description: 'Bacon Crocante', price: '3.90' },
    { id: `${productId}-extra-molho`, description: 'Molho Especial', price: '1.70' },
    { id: `${productId}-extra-cebola`, description: 'Cebola Crispy', price: '2.20' },
    { id: `${productId}-extra-picles`, description: 'Picles Extra', price: '1.30' },
    { id: `${productId}-extra-tomate`, description: 'Tomate Fresco', price: '1.80' },
    { id: `${productId}-extra-alface`, description: 'Alface Americana', price: '1.40' },
    { id: `${productId}-extra-cheddar`, description: 'Molho Cheddar', price: '2.90' },
    { id: `${productId}-extra-maionese`, description: 'Maionese Especial', price: '2.00' },
    { id: `${productId}-extra-pepperoni`, description: 'Pepperoni', price: '4.50' },
    { id: `${productId}-extra-ovo`, description: 'Ovo Estrelado', price: '3.20' },
    { id: `${productId}-extra-guacamole`, description: 'Guacamole', price: '3.80' },
    { id: `${productId}-extra-ketchup`, description: 'Ketchup Artesanal', price: '1.50' },
    { id: `${productId}-extra-mostarda`, description: 'Mostarda Dijon', price: '1.60' },
    { id: `${productId}-extra-paodealho`, description: 'Pão de Alho', price: '2.80' },
  ];
}

function buildCategoryExtraProducts(productId, profile) {
  if (profile === 'DRINK') {
    return [
      { id: `${productId}-extra-limao`, description: 'Limao Extra', price: '1.20' },
      { id: `${productId}-extra-gelo`, description: 'Gelo Extra', price: '0.80' },
      { id: `${productId}-extra-xarope`, description: 'Xarope Extra', price: '2.10' },
    ];
  }

  if (profile === 'SIDE') {
    return [
      { id: `${productId}-extra-molho-barbecue`, description: 'Molho Barbecue', price: '1.90' },
      { id: `${productId}-extra-molho-alho`, description: 'Molho de Alho', price: '1.60' },
      { id: `${productId}-extra-parmesao`, description: 'Parmesao Ralado', price: '1.70' },
    ];
  }

  if (profile === 'DESSERT') {
    return [
      { id: `${productId}-extra-granulado`, description: 'Granulado', price: '1.30' },
      { id: `${productId}-extra-calda`, description: 'Calda Extra', price: '1.90' },
      { id: `${productId}-extra-frutas`, description: 'Frutas Frescas', price: '2.30' },
    ];
  }

  return [
    { id: `${productId}-extra-cebola-roxa`, description: 'Cebola Roxa', price: '1.70' },
    { id: `${productId}-extra-tomate-seco`, description: 'Tomate Seco', price: '2.40' },
    { id: `${productId}-extra-pao-artesanal`, description: 'Pao Artesanal', price: '2.90' },
  ];
}

function buildDefaultExtraProducts(productId, profile) {
  return [
    ...buildCategoryExtraProducts(productId, profile),
    ...buildUniversalExtraProducts(productId),
  ];
}

function buildUniversalWithoutProducts(productId) {
  return [
    { id: `${productId}-without-cebola`, description: 'Sem cebola', price: '0.00' },
    { id: `${productId}-without-picles`, description: 'Sem picles', price: '0.00' },
    { id: `${productId}-without-molho`, description: 'Sem molho especial', price: '0.00' },
    { id: `${productId}-without-alface`, description: 'Sem alface', price: '0.00' },
  ];
}

function buildCategoryWithoutProducts(productId, profile) {
  if (profile === 'DRINK') {
    return [
      { id: `${productId}-without-gelo`, description: 'Sem gelo', price: '0.00' },
      { id: `${productId}-without-acucar`, description: 'Sem acucar', price: '0.00' },
      { id: `${productId}-without-limao`, description: 'Sem limao', price: '0.00' },
      { id: `${productId}-without-xarope`, description: 'Sem xarope', price: '0.00' },
    ];
  }

  if (profile === 'SIDE') {
    return [
      { id: `${productId}-without-sal`, description: 'Sem sal', price: '0.00' },
      { id: `${productId}-without-molho`, description: 'Sem molho', price: '0.00' },
      { id: `${productId}-without-queijo`, description: 'Sem queijo', price: '0.00' },
      { id: `${productId}-without-pimenta`, description: 'Sem pimenta', price: '0.00' },
    ];
  }

  if (profile === 'DESSERT') {
    return [
      { id: `${productId}-without-calda`, description: 'Sem calda', price: '0.00' },
      { id: `${productId}-without-granulado`, description: 'Sem granulado', price: '0.00' },
      { id: `${productId}-without-cobertura`, description: 'Sem cobertura', price: '0.00' },
      { id: `${productId}-without-frutas`, description: 'Sem frutas', price: '0.00' },
    ];
  }

  return [
    { id: `${productId}-without-cebola`, description: 'Sem cebola', price: '0.00' },
    { id: `${productId}-without-picles`, description: 'Sem picles', price: '0.00' },
    { id: `${productId}-without-molho`, description: 'Sem molho especial', price: '0.00' },
    { id: `${productId}-without-alface`, description: 'Sem alface', price: '0.00' },
  ];
}

function buildDefaultWithoutProducts(productId, profile) {
  return [
    ...buildCategoryWithoutProducts(productId, profile),
    ...buildUniversalWithoutProducts(productId),
  ];
}

function normalizeExtraProduct(extraProduct, fallbackId) {
  return {
    id: normalizeText(extraProduct.id || fallbackId),
    description: normalizeText(extraProduct.description) || 'Complemento',
    price: toPriceNumber(extraProduct.price).toFixed(2),
  };
}

function normalizeWithoutProduct(withoutProduct, fallbackId) {
  const description = normalizeText(withoutProduct.description) || 'Sem ingrediente';
  const normalizedDescription = description.toLowerCase().startsWith('sem ')
    ? description
    : `Sem ${description}`;

  return {
    id: normalizeText(withoutProduct.id || fallbackId),
    description: normalizedDescription,
    price: '0.00',
  };
}

function enrichProductComplements(product, category) {
  const profile = getCategoryCustomizationProfile(category);
  const existingCompositions = Array.isArray(product.compositions)
    ? product.compositions.map((entry) => ({ ...entry }))
    : [];
  const existingExtras = existingCompositions.filter(
    (entry) => normalizeText(entry.type).toUpperCase() === 'EXTRA'
  );
  const existingWithout = existingCompositions.filter(
    (entry) => normalizeText(entry.type).toUpperCase() === 'WITHOUT'
  );

  const defaults = buildDefaultExtraProducts(product.id, profile);
  const defaultWithout = buildDefaultWithoutProducts(product.id, profile);
  const extraById = new Map();
  const withoutById = new Map();

  for (const composition of existingExtras) {
    const baseProduct = composition.product && typeof composition.product === 'object'
      ? composition.product
      : {};
    const optionId = normalizeText(baseProduct.id || composition.id);
    if (!optionId) continue;
    extraById.set(optionId, normalizeExtraProduct(baseProduct, optionId));
  }

  for (const composition of existingWithout) {
    const baseProduct = composition.product && typeof composition.product === 'object'
      ? composition.product
      : {};
    const optionId = normalizeText(baseProduct.id || composition.id);
    if (!optionId) continue;
    withoutById.set(optionId, normalizeWithoutProduct(baseProduct, optionId));
  }

  for (const fallbackExtra of defaults) {
    if (!extraById.has(fallbackExtra.id)) {
      extraById.set(fallbackExtra.id, fallbackExtra);
    }

    if (extraById.size >= MINIMUM_COMPLEMENTS_PER_PRODUCT) {
      break;
    }
  }

  const normalizedExtraEntries = Array.from(extraById.values()).slice(0, MINIMUM_COMPLEMENTS_PER_PRODUCT);
  for (const fallbackWithout of defaultWithout) {
    if (!withoutById.has(fallbackWithout.id)) {
      withoutById.set(fallbackWithout.id, fallbackWithout);
    }

    if (withoutById.size >= MINIMUM_WITHOUT_OPTIONS_PER_PRODUCT) {
      break;
    }
  }

  const normalizedWithoutEntries = Array.from(withoutById.values()).slice(0, MINIMUM_WITHOUT_OPTIONS_PER_PRODUCT);

  const normalizedExtras = normalizedExtraEntries.map((extra, index) => ({
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

  const normalizedWithout = normalizedWithoutEntries.map((without, index) => ({
    id: `without-${product.id}-${index + 1}`,
    type: 'WITHOUT',
    product: {
      id: without.id,
      description: without.description,
      price: without.price,
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
    compositions: [...normalizedWithout, ...normalizedExtras],
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
            itemId: normalizeText(child.id),
            index,
            name: normalizeText(child.description),
            description: normalizeText(child.description),
            status: 'AVAILABLE',
            maxPermitted: Number.isInteger(child.maxQuantity) ? child.maxQuantity : 1,
            price: buildItemPrice(child.price),
          }))
      : [];

    if (options.length === 0) continue;

    groups.push({
      id: normalizeText(combo.id),
      index: groups.length,
      name: normalizeText(combo.description) || 'Escolha uma opcao',
      description: normalizeText(combo.description) || 'Escolha uma opcao',
      externalCode: normalizeText(combo.id) || `combo-${product.id}-${groups.length}`,
      status: 'AVAILABLE',
      minPermitted: Number.isInteger(combo.minQuantity) ? combo.minQuantity : 0,
      maxPermitted: Number.isInteger(combo.maxQuantity) ? combo.maxQuantity : 1,
      priceMethod: 'SUM',
      options,
    });
  }

  const extras = (product.compositions || []).filter(
    (entry) => normalizeText(entry.type).toUpperCase() === 'EXTRA'
  );
  const without = (product.compositions || []).filter(
    (entry) => normalizeText(entry.type).toUpperCase() === 'WITHOUT'
  );

  if (without.length > 0) {
    groups.push({
      id: `without-${product.id}`,
      index: groups.length,
      name: 'Remocoes',
      description: 'Remova ingredientes do seu produto',
      externalCode: `without-${product.id}`,
      status: 'AVAILABLE',
      minPermitted: 0,
      maxPermitted: without.length,
      priceMethod: 'SUM',
      options: without.map((entry, index) => {
        const withoutProduct = entry.product && typeof entry.product === 'object'
          ? entry.product
          : {};
        const normalizedWithout = normalizeWithoutProduct(
          withoutProduct,
          `${product.id}-without-${index + 1}`
        );

        return {
          id: normalizedWithout.id,
          itemId: normalizedWithout.id,
          index,
          name: normalizedWithout.description,
          description: normalizedWithout.description,
          status: 'AVAILABLE',
          maxPermitted: 1,
          price: buildItemPrice(0),
        };
      }),
    });
  }

  if (extras.length > 0) {
    groups.push({
      id: `extras-${product.id}`,
      index: groups.length,
      name: 'Complementos',
      description: 'Adicione complementos ao seu produto',
      externalCode: `extras-${product.id}`,
      status: 'AVAILABLE',
      minPermitted: 0,
      maxPermitted: extras.length,
      priceMethod: 'SUM',
      options: extras.map((entry, index) => {
        const extraProduct = entry.product && typeof entry.product === 'object'
          ? entry.product
          : {};
        const normalizedExtra = normalizeExtraProduct(
          extraProduct,
          `${product.id}-extra-${index + 1}`
        );
        return {
          id: normalizedExtra.id,
          itemId: normalizedExtra.id,
          index,
          name: normalizedExtra.description,
          description: normalizedExtra.description,
          status: 'AVAILABLE',
          maxPermitted: 99,
          price: buildItemPrice(normalizedExtra.price),
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
  const optionItemsById = new Map();
  const availabilityId = 'availability-all-day';
  const menuId = 'menu-main';

  for (const category of catalog) {
    const offerIds = [];

    for (const product of category.products || []) {
      const offerId = `offer-${product.id}`;
      offerIds.push(offerId);

      const productOptionGroups = buildOptionGroupsForProduct(product);
      for (const group of productOptionGroups) {
        optionGroups.push(group);

        for (const option of group.options || []) {
          if (optionItemsById.has(option.itemId)) {
            continue;
          }

          optionItemsById.set(option.itemId, {
            id: option.itemId,
            name: option.name,
            description: option.description,
            externalCode: option.itemId,
            status: 'AVAILABLE',
            unit: 'UN',
          });
        }
      }

      itemOffers.push({
        id: offerId,
        index: itemOffers.length,
        itemId: product.id,
        status: 'AVAILABLE',
        price: buildItemPrice(Number.parseFloat(product.price || 0) || 0),
        availabilityId: [availabilityId],
        optionGroupsId: productOptionGroups.map((group) => group.id),
      });

      items.push({
        id: product.id,
        name: product.name,
        description: product.description,
        externalCode: product.id,
        status: 'AVAILABLE',
        unit: 'UN',
        image: product.image_url ? { URL: product.image_url } : undefined,
      });
    }

    categories.push({
      id: category.id,
      name: category.description,
      description: category.description,
      index: categories.length,
      externalCode: category.id,
      status: 'AVAILABLE',
      itemOfferId: offerIds,
      availabilityId: [availabilityId],
    });
  }

  for (const optionItem of optionItemsById.values()) {
    items.push(optionItem);
  }

  const availabilities = [
    {
      id: availabilityId,
      hours: [
        {
          dayOfWeek: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
          timePeriods: {
            startTime: '00:00:00.000Z',
            endTime: '23:59:59.000Z',
          },
        },
      ],
    },
  ];

  const menus = [
    {
      id: menuId,
      name: 'Cardapio Principal',
      description: 'Cardapio principal do mock Altec',
      externalCode: menuId,
      categoryId: categories.map((category) => category.id),
    },
  ];

  const services = [
    {
      id: 'service-delivery-main',
      status: 'AVAILABLE',
      serviceType: 'DELIVERY',
      menuId,
      serviceHours: buildServiceHours('service-delivery-main'),
    },
  ];

  return {
    lastUpdate: new Date().toISOString(),
    TTL: 300,
    id: 'merchant-mock-altec',
    status: 'AVAILABLE',
    basicInfo: {
      name: 'Altec Mock Merchant',
      document: '00000000000000',
      corporateName: 'Altec Mock Merchant LTDA',
      description: 'Mock OpenDelivery para customizacao de produtos no totem.',
      averageTicket: 40,
      averagePreparationTime: 20,
      minOrderValue: {
        value: 0,
        currency: 'BRL',
      },
      merchantType: 'RESTAURANT',
      address: {
        country: 'BR',
        state: 'BR-SP',
        city: 'Sao Paulo',
        district: 'Centro',
        street: 'Rua Exemplo',
        number: '100',
        postalCode: '01001000',
        complement: 'Loja 1',
        reference: 'Mock API',
        latitude: -23.5505,
        longitude: -46.6333,
      },
      contactEmails: ['mock@altec.local'],
      contactPhones: {
        commercialNumber: '11999999999',
      },
      logoImage: {
        URL: 'https://example.com/altec-logo.png',
      },
    },
    services,
    menus,
    categories,
    itemOffers,
    items,
    optionGroups,
    availabilities,
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
