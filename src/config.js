'use strict';

/**
 * Central configuration loaded from environment variables with safe defaults.
 * Supports optional .env file via manual export or tooling like dotenv-cli.
 */

const PORT = parseInt(process.env.PORT || '10099', 10);
const USE_IN_MEMORY_ORDERS = process.env.USE_IN_MEMORY_ORDERS === 'true';

/** Mock API keys — static registry mapping key → tenant_id */
const API_KEYS = {
  ksk_mock_altec_001: 'tnt_altec',
  ksk_mock_altec_002: 'tnt_altec',
  ksk_mock_wildcard_001: '*',
};

/** Mock bootstrap activation codes mapping → kiosk identity */
const ACTIVATION_CODES = {
  'ACT-8812-XXQZ': {
    tenant_id: 'tnt_altec',
    establishment_id: 'est_sp_centro',
    kiosk_id: 'kio_009',
    api_key: 'ksk_mock_altec_002',
    expires_at: '2027-07-10T00:00:00Z',
  },
};

/** Known kiosk identities for config lookup */
const KNOWN_KIOSKS = new Set([
  'tnt_altec|est_sp_centro|kio_009',
  'tnt_altec|est_sp_centro|kio_001',
]);

/**
 * Allowed origins for CORS (HTTP) and WebSocket upgrade validation.
 * Used by both app.js and src/ws/ws_server.js.
 */
const ALLOWED_ORIGINS = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:10099',
  'http://127.0.0.1:10099',
];

module.exports = {
  PORT,
  USE_IN_MEMORY_ORDERS,
  API_KEYS,
  ACTIVATION_CODES,
  KNOWN_KIOSKS,
  ALLOWED_ORIGINS,
};
