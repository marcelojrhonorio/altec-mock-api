'use strict';

const express = require('express');
const { buildError } = require('../middlewares/auth');
const { ACTIVATION_CODES } = require('../config');

const router = express.Router();

const REQUIRED_FIELDS = ['activation_code', 'device_serial', 'app_version'];

/**
 * POST /v1/kiosks/bootstrap
 * Activates a kiosk using an activation code. Returns temporary credentials.
 * Does NOT require Authorization header — this is the provisioning endpoint.
 */
router.post('/kiosks/bootstrap', (req, res) => {
  const body = req.body;

  if (!body || typeof body !== 'object') {
    return res
      .status(400)
      .json(buildError(req, 'INVALID_REQUEST', 'Body ou parâmetros malformados.', { reason: 'Missing or invalid JSON body' }));
  }

  // If none of the required fields are present, the body is malformed
  const present = REQUIRED_FIELDS.filter((f) => body[f] !== undefined && body[f] !== null && body[f] !== '');
  if (present.length === 0) {
    return res
      .status(400)
      .json(buildError(req, 'INVALID_REQUEST', 'Body ou parâmetros malformados.', {
        missing_fields: REQUIRED_FIELDS,
      }));
  }

  // At least one field is present — validate all required fields
  const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
  if (missing.length > 0) {
    return res
      .status(422)
      .json(
        buildError(req, 'VALIDATION_ERROR', 'Campos obrigatórios faltando ou inválidos.', {
          missing_fields: missing,
        })
      );
  }

  const record = ACTIVATION_CODES[body.activation_code];
  if (!record) {
    return res
      .status(401)
      .json(buildError(req, 'UNAUTHORIZED', 'API key ausente ou inválida.', {}));
  }

  return res.status(200).json(record);
});

module.exports = router;
