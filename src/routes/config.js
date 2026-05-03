'use strict';

const express = require('express');
const { authenticate, buildError } = require('../middlewares/auth');
const { generateETag, isNotModified } = require('../services/etag');
const { getConfigData } = require('../services/config_loader');
const { KNOWN_KIOSKS } = require('../config');

const router = express.Router();

/**
 * Static data blocks — keyed by block name for ETag computation and include filtering.
 * Excludes per-request meta fields (request_id, trace_id, timestamp) so the ETag
 * is deterministic across requests for the same kiosk identity + include set.
 */
function buildStaticBlocks(configData) {
  return {
    branding:               configData.branding,
    establishment:          configData.establishment,
    media:                  configData.media,
    media_placement_rules:  configData.media_placement_rules,
    payment_methods:        configData.payment_methods,
    totem_behavior:         configData.totem_behavior,
    features:               configData.features,
    localization:           configData.localization,
  };
}

/**
 * GET /v1/tenants/:tenantId/establishments/:establishmentId/kiosks/:kioskId/config
 * Returns full or filtered kiosk configuration.
 * Supports ETag / If-None-Match → 304.
 */
router.get(
  '/tenants/:tenantId/establishments/:establishmentId/kiosks/:kioskId/config',
  authenticate(null), // tenant verified below after auth passes
  (req, res) => {
    let configData;
    try {
      configData = getConfigData();
    } catch (err) {
      return res
        .status(500)
        .json(
          buildError(req, 'SERVER_ERROR', 'Falha ao carregar configuração do servidor.', {
            reason: err.message,
          })
        );
    }

    const staticBlocks = buildStaticBlocks(configData);
    const { tenantId, establishmentId, kioskId } = req.params;

    // Tenant-level authorisation: wildcard keys bypass, fixed keys must match
    if (req.apiKeyTenant !== '*' && req.apiKeyTenant !== tenantId) {
      return res
        .status(403)
        .json(
          buildError(req, 'FORBIDDEN', 'API key válida, mas sem acesso ao recurso solicitado.', {
            tenant_id: tenantId,
          })
        );
    }

    // Kiosk existence check
    const kioskKey = `${tenantId}|${establishmentId}|${kioskId}`;
    if (!KNOWN_KIOSKS.has(kioskKey)) {
      return res
        .status(404)
        .json(
          buildError(req, 'CONFIG_NOT_FOUND', 'Nenhuma configuração encontrada para o kiosk informado.')
        );
    }

    // Resolve which data blocks to include (ETag computed ONLY from stable data, not request meta)
    const includeParam = req.query.include;
    let dataBlocks;
    if (includeParam) {
      const keys = includeParam
        .split(',')
        .map((s) => s.trim())
        .filter((k) => k in staticBlocks);
      dataBlocks = {};
      for (const k of keys) dataBlocks[k] = staticBlocks[k];
    } else {
      dataBlocks = staticBlocks;
    }

    // ETag is deterministic: based only on kiosk identity + stable data blocks
    const etagSeed = {
      kioskKey,
      config_version: configData.meta && configData.meta.config_version,
      ...dataBlocks,
    };
    const etag = generateETag('cfg', etagSeed);
    const ifNoneMatch = req.headers['if-none-match'];
    if (isNotModified(ifNoneMatch, etag)) {
      return res.status(304).end();
    }

    // Resolve locale: query param → config default
    const locale = req.query.locale || (configData.localization && configData.localization.default_locale) || 'pt-BR';

    // Compute generated_at and expires_at (cache max-age = 300s)
    const generatedAt = req.timestamp;
    const expiresAt = new Date(new Date(generatedAt).getTime() + 300_000).toISOString();

    // Build full response with per-request meta attached
    const responseBody = {
      meta: {
        request_id: req.requestId,
        trace_id: req.traceId,
        tenant_id: tenantId,
        establishment_id: establishmentId,
        kiosk_id: kioskId,
        schema_version: configData.meta && configData.meta.schema_version,
        config_version: configData.meta && configData.meta.config_version,
        config_hash: configData.meta && configData.meta.config_hash,
        generated_at: generatedAt,
        expires_at: expiresAt,
        locale,
      },
      ...dataBlocks,
    };

    res.set('ETag', etag);
    res.set('Cache-Control', 'private, max-age=300, stale-if-error=86400');
    return res.status(200).json(responseBody);
  }
);

module.exports = router;
