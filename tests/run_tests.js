'use strict';

/**
 * HTTP + WebSocket integration test suite for Altec Totem Mock API.
 *
 * Run:  bun run test
 *
 * Requires the server to be running (bun start) before executing.
 * Base URL can be overridden via TEST_BASE_URL / TEST_WS_URL environment variables.
 */

const http = require('http');
const net  = require('net');
const fs = require('fs');
const path = require('path');
// WS tests use Bun's native global WebSocket (browser-compatible API)
// instead of the ws npm package to avoid Bun shim incompatibilities.

const CONFIG_FILE = path.join(__dirname, '../data/config_full.json');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:10099/v1';
const WS_BASE  = process.env.TEST_WS_URL   || 'ws://127.0.0.1:10099';
const VALID_KEY    = 'ksk_mock_altec_001';
const WILDCARD_KEY = 'ksk_mock_wildcard_001';
const INVALID_KEY  = 'ksk_invalid_key';

let passed = 0;
let failed = 0;
const failures = [];

// ── HTTP helper ───────────────────────────────────────────────────────────────

function request(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

function assert(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    const msg = `  ❌ ${label}${detail ? ' — ' + detail : ''}`;
    console.log(msg);
    failures.push(msg);
  }
}

async function test(name, fn) {
  console.log(`\n▶  ${name}`);
  try {
    await fn();
  } catch (err) {
    failed++;
    const msg = `  ❌ THREW: ${err.message}`;
    console.log(msg);
    failures.push(`${name}: ${msg}`);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

const AUTH = { Authorization: `ApiKey ${VALID_KEY}` };
const AUTH_WILDCARD = { Authorization: `ApiKey ${WILDCARD_KEY}` };
const AUTH_INVALID = { Authorization: `ApiKey ${INVALID_KEY}` };
const AUTH_MISSING = {};

// ── WebSocket helpers ─────────────────────────────────────────────────────────

/**
 * Sends a raw TCP HTTP Upgrade request and returns the HTTP response status code.
 * Using net.connect instead of http.request because Bun's http client does not
 * call the response callback for Upgrade requests that are rejected with a non-101
 * status — it waits for an 'upgrade' event that never fires on rejection.
 */
function wsHandshakeStatus(path) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 10099 }, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:10099\r\n` +
        `Connection: Upgrade\r\n` +
        `Upgrade: websocket\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `\r\n`
      );
    });

    let buf = '';
    let resolved = false;

    function tryResolve(status) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(status);
      }
    }

    socket.on('data', (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/^HTTP\/1\.\d (\d{3})/);
      if (match) tryResolve(parseInt(match[1], 10));
    });

    const timer = setTimeout(() => tryResolve(0), 3000);
    socket.on('close', () => tryResolve(0));
    socket.on('error', () => tryResolve(0));
  });
}

/**
 * Opens a WebSocket using Bun's native global WebSocket (browser-compatible).
 * Resolves with the ws instance on open, or { rejected: true } on failure.
 */
function wsConnect(path, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_BASE + path);
    let opened = false;
    let settled = false;

    function settle(value) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    }

    const timer = setTimeout(() => settle({ rejected: true, status: 0 }), timeoutMs);

    ws.addEventListener('open', () => { opened = true; settle(ws); });
    ws.addEventListener('error', () => { if (!opened) settle({ rejected: true, status: 0 }); });
    ws.addEventListener('close', () => { if (!opened) settle({ rejected: true, status: 0 }); });
  });
}

/** Wait for the next message on a WebSocket. Rejects on timeout. */
function wsMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    function onMessage(event) {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      try { resolve(JSON.parse(event.data)); }
      catch { resolve(event.data); }
    }

    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error('WS message timeout'));
    }, timeoutMs);

    ws.addEventListener('message', onMessage);
  });
}

/** Close a WebSocket gracefully and wait for the close event. */
function wsClose(ws) {
  if (!ws || typeof ws.close !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    if (ws.readyState === 3 /* CLOSED */) return resolve();
    function onClose() { ws.removeEventListener('close', onClose); resolve(); }
    ws.addEventListener('close', onClose);
    ws.close();
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runAll() {
  // ── Config ────────────────────────────────────────────────────────────────
  await test('GET /config — 200 full response', async () => {
    const r = await request('GET', '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config', { headers: AUTH });
    assert('status 200', r.status === 200);
    assert('has meta', !!r.body?.meta);
    assert('has branding', !!r.body?.branding);
    assert('has payment_methods', Array.isArray(r.body?.payment_methods));
    assert('has ETag header', !!r.headers['etag']);
  });

  await test('GET /config — 200 with ?include filter', async () => {
    const r = await request('GET', '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config?include=branding,payment_methods', { headers: AUTH });
    assert('status 200', r.status === 200);
    assert('has branding', !!r.body?.branding);
    assert('has payment_methods', !!r.body?.payment_methods);
    assert('no catalog block', r.body?.catalog === undefined);
  });

  await test('GET /config — 304 ETag cache', async () => {
    const r1 = await request('GET', '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config', { headers: AUTH });
    const etag = r1.headers['etag'];
    assert('first call returns ETag', !!etag);

    const r2 = await request('GET', '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config', {
      headers: { ...AUTH, 'If-None-Match': etag },
    });
    assert('second call returns 304', r2.status === 304);
    assert('304 has no body', !r2.body);
  });

  await test('GET /config — reflects config_full.json changes without server restart', async () => {
    const originalRaw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const original = JSON.parse(originalRaw);
    const oldColor = original?.branding?.primary_color;
    const newColor = oldColor === '#11AA66' ? '#D932FF' : '#11AA66';

    const r1 = await request(
      'GET',
      '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config',
      { headers: AUTH }
    );
    const etagBefore = r1.headers['etag'];

    const updated = JSON.parse(originalRaw);
    updated.branding = { ...(updated.branding || {}), primary_color: newColor };

    // Ensure mtime changes in filesystems with lower timestamp precision.
    await new Promise((resolve) => setTimeout(resolve, 20));

    try {
      fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');

      const r2 = await request(
        'GET',
        '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config',
        { headers: AUTH }
      );

      assert('status 200 after file change', r2.status === 200);
      assert('new primary_color reflected', r2.body?.branding?.primary_color === newColor);
      assert('ETag changed after file change', !!etagBefore && !!r2.headers['etag'] && etagBefore !== r2.headers['etag']);
    } finally {
      fs.writeFileSync(CONFIG_FILE, originalRaw, 'utf8');
    }
  });

  await test('GET /config — 401 missing auth', async () => {
    const r = await request('GET', '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config', { headers: AUTH_MISSING });
    assert('status 401', r.status === 401);
    assert('code UNAUTHORIZED', r.body?.error?.code === 'UNAUTHORIZED');
  });

  await test('GET /config — 401 invalid key', async () => {
    const r = await request('GET', '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config', { headers: AUTH_INVALID });
    assert('status 401', r.status === 401);
  });

  await test('GET /config — 403 wrong tenant', async () => {
    const r = await request('GET', '/tenants/tnt_other/establishments/est_sp_centro/kiosks/kio_009/config', { headers: AUTH });
    assert('status 403', r.status === 403);
    assert('code FORBIDDEN', r.body?.error?.code === 'FORBIDDEN');
  });

  await test('GET /config — 404 unknown kiosk', async () => {
    const r = await request('GET', '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_unknown/config', { headers: AUTH });
    assert('status 404', r.status === 404);
    assert('code CONFIG_NOT_FOUND', r.body?.error?.code === 'CONFIG_NOT_FOUND');
  });

  await test('GET /config — wildcard key bypasses tenant check', async () => {
    const r = await request('GET', '/tenants/tnt_altec/establishments/est_sp_centro/kiosks/kio_009/config', { headers: AUTH_WILDCARD });
    assert('status 200', r.status === 200);
  });

  // ── Bootstrap ────────────────────────────────────────────────────────────
  await test('POST /bootstrap — 200 valid activation', async () => {
    const r = await request('POST', '/kiosks/bootstrap', {
      headers: AUTH,
      body: { activation_code: 'ACT-8812-XXQZ', device_serial: 'SN-001', app_version: '1.0' },
    });
    assert('status 200', r.status === 200);
    assert('has tenant_id', !!r.body?.tenant_id);
    assert('has api_key', !!r.body?.api_key);
    assert('has kiosk_id', !!r.body?.kiosk_id);
  });

  await test('POST /bootstrap — 422 missing fields', async () => {
    const r = await request('POST', '/kiosks/bootstrap', {
      headers: AUTH,
      body: { activation_code: 'ACT-8812-XXQZ' },
    });
    assert('status 422', r.status === 422);
    assert('code VALIDATION_ERROR', r.body?.error?.code === 'VALIDATION_ERROR');
    assert('missing_fields listed', Array.isArray(r.body?.error?.details?.missing_fields));
  });

  await test('POST /bootstrap — 401 unknown activation code', async () => {
    const r = await request('POST', '/kiosks/bootstrap', {
      body: { activation_code: 'INVALID-CODE', device_serial: 'SN-001', app_version: '1.0' },
    });
    assert('status 401', r.status === 401);
    assert('code UNAUTHORIZED', r.body?.error?.code === 'UNAUTHORIZED');
  });

  await test('POST /bootstrap — 400 empty body', async () => {
    const r = await request('POST', '/kiosks/bootstrap', { body: {} });
    assert('status 400', r.status === 400);
    assert('code INVALID_REQUEST', r.body?.error?.code === 'INVALID_REQUEST');
  });

  await test('POST /bootstrap — no auth required (public endpoint)', async () => {
    const r = await request('POST', '/kiosks/bootstrap', {
      headers: AUTH_MISSING,
      body: { activation_code: 'ACT-8812-XXQZ', device_serial: 'SN-001', app_version: '1.0' },
    });
    assert('status 200 without auth', r.status === 200);
    assert('has tenant_id', !!r.body?.tenant_id);
    assert('has api_key', !!r.body?.api_key);
  });

  // ── Catalog ───────────────────────────────────────────────────────────────
  await test('GET /catalog — 200 full catalog', async () => {
    const r = await request('GET', '/catalog', { headers: AUTH });
    assert('status 200', r.status === 200);
    assert('is array', Array.isArray(r.body));
    assert('first item has id', !!r.body?.[0]?.id);
    assert('first item has products', Array.isArray(r.body?.[0]?.products));
    assert('has ETag header', !!r.headers['etag']);
  });

  await test('GET /catalog — 304 ETag cache', async () => {
    const r1 = await request('GET', '/catalog', { headers: AUTH });
    const etag = r1.headers['etag'];
    assert('first call returns ETag', !!etag);

    const r2 = await request('GET', '/catalog', {
      headers: { ...AUTH, 'If-None-Match': etag },
    });
    assert('second call returns 304', r2.status === 304);
  });

  await test('GET /catalog — 401 no auth', async () => {
    const r = await request('GET', '/catalog', { headers: AUTH_MISSING });
    assert('status 401', r.status === 401);
  });

  await test('GET /merchant — 200 with OpenDelivery essentials', async () => {
    const r = await request('GET', '/merchant', { headers: AUTH });
    assert('status 200', r.status === 200);
    assert('has categories array', Array.isArray(r.body?.categories));
    assert('has itemOffers array', Array.isArray(r.body?.itemOffers));
    assert('has items array', Array.isArray(r.body?.items));
    assert('has optionGroups array', Array.isArray(r.body?.optionGroups));
    assert('has services array', Array.isArray(r.body?.services));
    assert('has menus array', Array.isArray(r.body?.menus));
  });

  await test('GET /merchant — OpenDelivery structural fields for customization entities', async () => {
    const r = await request('GET', '/merchant', { headers: AUTH });
    assert('status 200', r.status === 200);

    const categories = Array.isArray(r.body?.categories) ? r.body.categories : [];
    const itemOffers = Array.isArray(r.body?.itemOffers) ? r.body.itemOffers : [];
    const optionGroups = Array.isArray(r.body?.optionGroups) ? r.body.optionGroups : [];

    const invalidCategories = categories.filter((category) => (
      !category?.id ||
      !Number.isInteger(category?.index) ||
      !category?.name ||
      !category?.externalCode ||
      !['AVAILABLE', 'UNAVAILABLE'].includes(String(category?.status))
    ));

    const invalidItemOffers = itemOffers.filter((offer) => {
      const price = offer?.price;
      return (
        !offer?.id ||
        !offer?.itemId ||
        !Number.isInteger(offer?.index) ||
        !['AVAILABLE', 'UNAVAILABLE'].includes(String(offer?.status)) ||
        typeof price?.value !== 'number' ||
        typeof price?.originalValue !== 'number' ||
        price?.currency !== 'BRL'
      );
    });

    const invalidOptionGroups = optionGroups.filter((group) => (
      !group?.id ||
      !Number.isInteger(group?.index) ||
      !group?.name ||
      !group?.externalCode ||
      !['AVAILABLE', 'UNAVAILABLE'].includes(String(group?.status)) ||
      !Number.isInteger(group?.minPermitted) ||
      !Number.isInteger(group?.maxPermitted)
    ));

    const invalidOptions = [];
    for (const group of optionGroups) {
      const options = Array.isArray(group?.options) ? group.options : [];
      for (const option of options) {
        const price = option?.price;
        const isValid = (
          !!option?.id &&
          !!option?.itemId &&
          Number.isInteger(option?.index) &&
          ['AVAILABLE', 'UNAVAILABLE'].includes(String(option?.status)) &&
          typeof price?.value === 'number' &&
          typeof price?.originalValue === 'number' &&
          price?.currency === 'BRL'
        );
        if (!isValid) {
          invalidOptions.push(`${group?.id || 'unknown-group'}:${option?.id || 'unknown-option'}`);
        }
      }
    }

    assert('all categories include required OD fields', invalidCategories.length === 0, JSON.stringify(invalidCategories.slice(0, 3)));
    assert('all itemOffers include required OD fields', invalidItemOffers.length === 0, JSON.stringify(invalidItemOffers.slice(0, 3)));
    assert('all optionGroups include required OD fields', invalidOptionGroups.length === 0, JSON.stringify(invalidOptionGroups.slice(0, 3)));
    assert('all options include required OD fields', invalidOptions.length === 0, invalidOptions.slice(0, 5).join(','));
  });

  await test('GET /merchant — every product has complements mapped', async () => {
    const r = await request('GET', '/merchant', { headers: AUTH });
    const itemOffers = Array.isArray(r.body?.itemOffers) ? r.body.itemOffers : [];
    const optionGroups = Array.isArray(r.body?.optionGroups) ? r.body.optionGroups : [];
    const optionGroupsById = new Map(optionGroups.map((g) => [g.id, g]));

    const offersWithoutGroups = [];
    const offersWithInvalidComplements = [];

    for (const offer of itemOffers) {
      const groupIds = Array.isArray(offer?.optionGroupsId) ? offer.optionGroupsId : [];
      if (groupIds.length === 0) {
        offersWithoutGroups.push(offer?.itemId || offer?.id || 'unknown');
        continue;
      }

      let totalOptions = 0;
      let hasComplementsGroup = false;
      let complementsCount = 0;
      let hasInvalidPrice = false;

      for (const groupId of groupIds) {
        const group = optionGroupsById.get(groupId);
        if (!group) {
          offersWithInvalidComplements.push(`${offer?.itemId || 'unknown'}:missing:${groupId}`);
          continue;
        }

        const options = Array.isArray(group.options) ? group.options : [];
        totalOptions += options.length;

        if (String(group?.name || '').toLowerCase() === 'complementos') {
          hasComplementsGroup = true;
          complementsCount = options.length;
        }

        for (const option of options) {
          const price = option?.price;
          const hasValidValue = typeof price?.value === 'number' && Number.isFinite(price.value);
          const hasValidCurrency = price?.currency === 'BRL';
          if (!hasValidValue || !hasValidCurrency) {
            hasInvalidPrice = true;
            break;
          }
        }

        if (hasInvalidPrice) {
          break;
        }
      }

      if (!hasComplementsGroup) {
        offersWithInvalidComplements.push(`${offer?.itemId || 'unknown'}:missing-complements-group`);
        continue;
      }

      if (complementsCount < 15) {
        offersWithInvalidComplements.push(`${offer?.itemId || 'unknown'}:few-complements:${complementsCount}`);
        continue;
      }

      if (hasInvalidPrice) {
        offersWithInvalidComplements.push(`${offer?.itemId || 'unknown'}:invalid-price`);
      }
    }

    assert('no offer without optionGroupsId', offersWithoutGroups.length === 0, offersWithoutGroups.join(','));
    assert(
      'all products expose at least fifteen complements with OpenDelivery pricing',
      offersWithInvalidComplements.length === 0,
      offersWithInvalidComplements.join(','),
    );
  });

  await test('GET /products/:id — compatibility payload keeps five extras', async () => {
    const merchant = await request('GET', '/merchant', { headers: AUTH });
    const firstOffer = Array.isArray(merchant.body?.itemOffers) ? merchant.body.itemOffers[0] : null;
    const productId = firstOffer?.itemId;

    assert('merchant returned an item id', typeof productId === 'string' && productId.length > 0);

    const r = await request('GET', `/products/${productId}`, { headers: AUTH });
    assert('status 200', r.status === 200);

    const compositions = Array.isArray(r.body?.data?.compositions) ? r.body.data.compositions : [];
    const extras = compositions.filter((entry) => String(entry?.type || '').toUpperCase() === 'EXTRA');

    assert('has at least five extras', extras.length >= 5, String(extras.length));
    assert(
      'all extras expose a numeric price payload',
      extras.every((entry) => Number.isFinite(Number(entry?.product?.price))),
    );
  });

  // ── orderUpdate ──────────────────────────────────────────────────────────
  const testOrderId = `order-test-${Date.now()}`;
  const validEvent = {
    eventId: 'evt-test-001',
    eventType: 'CREATED',
    orderId: testOrderId,
    createdAt: new Date().toISOString(),
    metadata: {
      order: {
        id: testOrderId,
        type: 'INDOOR',
        displayId: 'PED-TEST',
        createdAt: new Date().toISOString(),
        orderTiming: 'INSTANT',
        preparationStartDateTime: new Date().toISOString(),
        merchant: { id: 'merch-001', name: 'Test Store' },
        items: [
          {
            id: 'item-001',
            name: 'Pizza',
            unit: 'UN',
            quantity: 1,
            unitPrice: { value: 45.00, currency: 'BRL' },
            totalPrice: { value: 45.00, currency: 'BRL' },
            externalCode: 'prod-001',
            options: [],
          },
        ],
        total: {
          itemsPrice:  { value: 45.00, currency: 'BRL' },
          otherFees:   { value:  0.00, currency: 'BRL' },
          discount:    { value:  0.00, currency: 'BRL' },
          orderAmount: { value: 45.00, currency: 'BRL' },
        },
        payments: {
          prepaid: 45.00,
          pending: 0.00,
          methods: [{ value: 45.00, currency: 'BRL', type: 'PREPAID', method: 'PIX' }],
        },
      },
    },
  };

  await test('POST /orderUpdate — 202 ACCEPTED', async () => {
    const r = await request('POST', '/orderUpdate', { headers: AUTH, body: validEvent });
    assert('status 202', r.status === 202);
    assert('status ACCEPTED', r.body?.status === 'ACCEPTED');
    assert('orderId matches', r.body?.orderId === testOrderId);
  });

  await test('POST /orderUpdate — 422 wrong eventType', async () => {
    const r = await request('POST', '/orderUpdate', {
      headers: AUTH,
      body: { ...validEvent, eventType: 'UPDATED' },
    });
    assert('status 422', r.status === 422);
    assert('code VALIDATION_ERROR', r.body?.error?.code === 'VALIDATION_ERROR');
  });

  await test('POST /orderUpdate — 422 missing orderId', async () => {
    const { orderId: _omit, ...noOrderId } = validEvent;
    const r = await request('POST', '/orderUpdate', { headers: AUTH, body: noOrderId });
    assert('status 422', r.status === 422);
  });

  await test('POST /orderUpdate — 422 missing metadata.order', async () => {
    const r = await request('POST', '/orderUpdate', {
      headers: AUTH,
      body: { ...validEvent, metadata: {} },
    });
    assert('status 422', r.status === 422);
  });

  await test('POST /orderUpdate — 401 no auth', async () => {
    const r = await request('POST', '/orderUpdate', { headers: AUTH_MISSING, body: validEvent });
    assert('status 401', r.status === 401);
  });

  // ── orders/{orderId} ──────────────────────────────────────────────────────
  await test('GET /orders/:id — 200 from dynamic store (posted above)', async () => {
    const r = await request('GET', `/orders/${testOrderId}`, { headers: AUTH });
    assert('status 200', r.status === 200);
    assert('id matches', r.body?.id === testOrderId);
    assert('has items', Array.isArray(r.body?.items));
  });

  await test('GET /orders/:id — 200 from static store', async () => {
    const r = await request('GET', '/orders/order-test-001', { headers: AUTH });
    assert('status 200', r.status === 200);
    assert('id order-test-001', r.body?.id === 'order-test-001');
  });

  await test('GET /orders/:id — 404 ORDER_NOT_FOUND', async () => {
    const r = await request('GET', '/orders/order-does-not-exist', { headers: AUTH });
    assert('status 404', r.status === 404);
    assert('code ORDER_NOT_FOUND', r.body?.error?.code === 'ORDER_NOT_FOUND');
  });

  await test('GET /orders/:id — 401 no auth', async () => {
    const r = await request('GET', '/orders/order-test-001', { headers: AUTH_MISSING });
    assert('status 401', r.status === 401);
  });

  // ── WebSocket ─────────────────────────────────────────────────────────────

  await test('WS — connection rejected without api_key', async () => {
    const result = await wsConnect('/v1/ws');
    assert('connection refused (no key)', result.rejected === true);
  });

  await test('WS — connection rejected with invalid api_key', async () => {
    const result = await wsConnect(`/v1/ws?api_key=${INVALID_KEY}`);
    assert('connection refused (bad key)', result.rejected === true);
  });

  await test('WS — connected message on valid auth', async () => {
    const ws = await wsConnect(`/v1/ws?api_key=${VALID_KEY}`);
    assert('socket open', ws && !ws.rejected);
    const msg = await wsMessage(ws);
    assert('type connected', msg.type === 'connected');
    assert('has session_id', typeof msg.session_id === 'string');
    assert('has server_time', typeof msg.server_time === 'string');
    await wsClose(ws);
  });

  await test('WS — 404 connection with unknown kiosk', async () => {
    const result = await wsConnect(
      `/v1/ws?api_key=${VALID_KEY}&establishment_id=est_sp_centro&kiosk_id=kio_INVALIDO`
    );
    assert('connection refused (unknown kiosk)', result.rejected === true);
  });

  await test('WS — init event received when connecting with kiosk identity', async () => {
    const ws = await wsConnect(
      `/v1/ws?api_key=${VALID_KEY}&establishment_id=est_sp_centro&kiosk_id=kio_009`
    );
    assert('socket open', ws && !ws.rejected);

    const connected = await wsMessage(ws);
    assert('first message is connected', connected.type === 'connected');
    assert('has session_id', typeof connected.session_id === 'string');

    const init = await wsMessage(ws);
    assert('second message is init', init.type === 'init');
    assert('init has config', typeof init.config === 'object');
    assert('config has branding', typeof init.config.branding === 'object');
    assert('config has establishment', typeof init.config.establishment === 'object');
    assert('config has payment_methods', Array.isArray(init.config.payment_methods));
    assert('config has totem_behavior', typeof init.config.totem_behavior === 'object');
    assert('config has features', typeof init.config.features === 'object');
    assert('config has localization', typeof init.config.localization === 'object');
    await wsClose(ws);
  });

  await test('WS — auto-subscribed to kiosk on connect (push event without explicit subscribe)', async () => {
    const ws = await wsConnect(
      `/v1/ws?api_key=${VALID_KEY}&establishment_id=est_sp_centro&kiosk_id=kio_009`
    );
    await wsMessage(ws); // consume 'connected'
    await wsMessage(ws); // consume 'init'

    // Arm listener BEFORE HTTP trigger
    const wsEventPromise = wsMessage(ws, 4000);

    const wsOrderId = `order-autosub-${Date.now()}`;
    const r = await request('POST', '/orderUpdate', {
      headers: AUTH,
      body: {
        ...validEvent,
        orderId: wsOrderId,
        metadata: { order: { ...validEvent.metadata.order, id: wsOrderId } },
      },
    });
    assert('202 ACCEPTED', r.status === 202);

    const wsEvent = await wsEventPromise;
    assert('type order_status_changed', wsEvent.type === 'order_status_changed');
    assert('order_id matches', wsEvent.order_id === wsOrderId);
    await wsClose(ws);
  });

  await test('WS — ping / pong', async () => {
    const ws = await wsConnect(`/v1/ws?api_key=${VALID_KEY}`);
    await wsMessage(ws); // consume 'connected'
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await wsMessage(ws);
    assert('type pong', msg.type === 'pong');
    assert('has timestamp', typeof msg.timestamp === 'string');
    await wsClose(ws);
  });

  await test('WS — subscribe to valid kiosk', async () => {
    const ws = await wsConnect(`/v1/ws?api_key=${VALID_KEY}`);
    await wsMessage(ws); // consume 'connected'
    ws.send(JSON.stringify({
      type: 'subscribe',
      kiosk: { tenant_id: 'tnt_altec', establishment_id: 'est_sp_centro', kiosk_id: 'kio_009' },
    }));
    const msg = await wsMessage(ws);
    assert('type subscribed', msg.type === 'subscribed');
    assert('kiosk_key correct', msg.kiosk_key === 'tnt_altec|est_sp_centro|kio_009');
    await wsClose(ws);
  });

  await test('WS — subscribe with wrong tenant returns error FORBIDDEN', async () => {
    const ws = await wsConnect(`/v1/ws?api_key=${VALID_KEY}`);
    await wsMessage(ws); // consume 'connected'
    ws.send(JSON.stringify({
      type: 'subscribe',
      kiosk: { tenant_id: 'tnt_outro', establishment_id: 'est_sp_centro', kiosk_id: 'kio_009' },
    }));
    const msg = await wsMessage(ws);
    assert('type error', msg.type === 'error');
    assert('code FORBIDDEN', msg.code === 'FORBIDDEN');
    await wsClose(ws);
  });

  await test('WS — unknown message type returns error', async () => {
    const ws = await wsConnect(`/v1/ws?api_key=${VALID_KEY}`);
    await wsMessage(ws); // consume 'connected'
    ws.send(JSON.stringify({ type: 'unknown_type' }));
    const msg = await wsMessage(ws);
    assert('type error', msg.type === 'error');
    assert('code UNKNOWN_MESSAGE_TYPE', msg.code === 'UNKNOWN_MESSAGE_TYPE');
    await wsClose(ws);
  });

  await test('WS — order_status_changed pushed after POST /orderUpdate', async () => {
    const ws = await wsConnect(`/v1/ws?api_key=${VALID_KEY}`);
    await wsMessage(ws); // consume 'connected'

    // Subscribe to the kiosk
    ws.send(JSON.stringify({
      type: 'subscribe',
      kiosk: { tenant_id: 'tnt_altec', establishment_id: 'est_sp_centro', kiosk_id: 'kio_009' },
    }));
    const subMsg = await wsMessage(ws);
    assert('subscribed', subMsg.type === 'subscribed');

    // Arm the listener BEFORE the HTTP request
    const wsEventPromise = wsMessage(ws, 4000);

    const wsOrderId = `order-ws-${Date.now()}`;
    const r = await request('POST', '/orderUpdate', {
      headers: AUTH,
      body: {
        ...validEvent,
        orderId: wsOrderId,
        metadata: { order: { ...validEvent.metadata.order, id: wsOrderId } },
      },
    });
    assert('202 ACCEPTED', r.status === 202);

    const wsEvent = await wsEventPromise;
    assert('type order_status_changed', wsEvent.type === 'order_status_changed');
    assert('order_id matches', wsEvent.order_id === wsOrderId);
    assert('status CREATED', wsEvent.status === 'CREATED');

    await wsClose(ws);
  });

  await test('WS — POST /ws/emit delivers event to subscribed session', async () => {
    const ws = await wsConnect(`/v1/ws?api_key=${VALID_KEY}`);
    await wsMessage(ws); // consume 'connected'

    ws.send(JSON.stringify({
      type: 'subscribe',
      kiosk: { tenant_id: 'tnt_altec', establishment_id: 'est_sp_centro', kiosk_id: 'kio_009' },
    }));
    await wsMessage(ws); // consume 'subscribed'

    // Arm listener BEFORE HTTP trigger
    const wsEventPromise = wsMessage(ws, 4000);

    const r = await request('POST', '/ws/emit', {
      headers: AUTH,
      body: {
        event_type: 'catalog_invalidated',
        target: { tenant_id: 'tnt_altec' },
        payload: { reason: 'test' },
      },
    });
    assert('200 EMITTED', r.status === 200);
    assert('delivered_to >= 1', r.body?.delivered_to >= 1);

    const wsEvent = await wsEventPromise;
    assert('type catalog_invalidated', wsEvent.type === 'catalog_invalidated');
    assert('has reason payload', wsEvent.reason === 'test');

    await wsClose(ws);
  });

  await test('POST /ws/emit — 422 missing event_type', async () => {
    const r = await request('POST', '/ws/emit', { headers: AUTH, body: { target: {} } });
    assert('status 422', r.status === 422);
    assert('code VALIDATION_ERROR', r.body?.error?.code === 'VALIDATION_ERROR');
  });

  await test('POST /ws/emit — 401 no auth', async () => {
    const r = await request('POST', '/ws/emit', {
      headers: AUTH_MISSING,
      body: { event_type: 'test' },
    });
    assert('status 401', r.status === 401);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log(`Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailed assertions:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  } else {
    console.log('\nAll tests passed 🎉');
  }
}

runAll().catch((err) => {
  console.error('Test runner error:', err.message);
  console.error('Is the server running? npm start');
  process.exit(1);
});
