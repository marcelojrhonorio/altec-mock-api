'use strict';

const { API_KEYS } = require('../config');

/**
 * Validates Authorization header in format "ApiKey {key}".
 * Attaches req.tenantId (or '*' for wildcard) on success.
 *
 * @param {string|null} requiredTenantId  – path-level tenant to verify, or null to skip tenant check
 */
function authenticate(requiredTenantId = null) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const match = authHeader.match(/^ApiKey\s+(\S+)$/i);

    if (!match) {
      return res.status(401).json(buildError(req, 'UNAUTHORIZED', 'API key ausente ou inválida.'));
    }

    const key = match[1];
    const tenant = API_KEYS[key];

    if (!tenant) {
      return res.status(401).json(buildError(req, 'UNAUTHORIZED', 'API key ausente ou inválida.'));
    }

    // Tenant-scoped validation: wildcard bypasses, otherwise must match
    if (requiredTenantId && tenant !== '*' && tenant !== requiredTenantId) {
      return res.status(403).json(
        buildError(req, 'FORBIDDEN', 'API key válida, mas sem acesso ao recurso solicitado.', {
          tenant_id: requiredTenantId,
        })
      );
    }

    req.apiKeyTenant = tenant;
    next();
  };
}

function buildError(req, code, message, details = {}) {
  return {
    error: {
      code,
      message,
      details,
      request_id: req.requestId,
      trace_id: req.traceId,
      timestamp: req.timestamp,
    },
  };
}

module.exports = { authenticate, buildError };
