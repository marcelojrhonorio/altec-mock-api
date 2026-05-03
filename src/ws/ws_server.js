'use strict';

const { WebSocketServer } = require('ws');
const { API_KEYS, KNOWN_KIOSKS, ALLOWED_ORIGINS } = require('../config');
const { getConfigData } = require('../services/config_loader');
const { addSession, removeSession, subscribe, unsubscribe } = require('../services/ws_manager');

const WS_PATH = '/v1/ws';
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Attaches a WebSocketServer to an existing http.Server.
 * Handles the HTTP upgrade event directly so both HTTP and WS share port 10099.
 *
 * Auth:   query string  ?api_key=<key>
 * Kiosk:  optional      &establishment_id=<id>&kiosk_id=<id>
 *
 * When kiosk identity is provided the server:
 *   - validates the kiosk exists
 *   - auto-subscribes the session to that kiosk
 *   - pushes a { type: 'init', config: { ... } } message right after 'connected'
 *
 * All subsequent data fetches (catalog, orders, etc.) use normal HTTP endpoints.
 *
 * @param {import('http').Server} httpServer
 */
function createWsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // ── Upgrade handler — runs before WebSocket handshake is completed ────────
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');

    // Only handle our WS path — let other upgrades pass or destroy
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    // Validate Origin header (browsers always send it; native apps may omit it)
    const origin = req.headers['origin'];
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }

    // Authenticate via ?api_key query param
    const apiKey = url.searchParams.get('api_key');
    const tenantId = apiKey ? API_KEYS[apiKey] : undefined;

    if (!tenantId) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }

    // Optional kiosk identity — if provided, validate and auto-subscribe on connect
    const establishmentId = url.searchParams.get('establishment_id');
    const kioskId         = url.searchParams.get('kiosk_id');

    let kioskKey = null;
    if (establishmentId && kioskId) {
      // Wildcard keys must also supply tenant_id so we can build the kiosk key
      const effectiveTenant = (tenantId !== '*') ? tenantId : url.searchParams.get('tenant_id');
      if (!effectiveTenant) {
        socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        return;
      }
      kioskKey = `${effectiveTenant}|${establishmentId}|${kioskId}`;
      if (!KNOWN_KIOSKS.has(kioskKey)) {
        socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        return;
      }
    }

    // Complete handshake — carry auth + kiosk context into the connection event
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._altecTenantId = tenantId;
      ws._altecKioskKey = kioskKey; // null when kiosk params were not supplied
      wss.emit('connection', ws, req);
    });
  });

  // ── Connection lifecycle ──────────────────────────────────────────────────
  wss.on('connection', (ws) => {
    const sessionId = addSession(ws, ws._altecTenantId);

    // Notify client it is connected
    send(ws, {
      type: 'connected',
      session_id: sessionId,
      server_time: new Date().toISOString(),
    });

    // If kiosk identity was provided at connect time:
    //   • auto-subscribe the session (no need for a separate 'subscribe' message)
    //   • push the full initial config so the client can skip the HTTP /config call
    if (ws._altecKioskKey) {
      subscribe(sessionId, ws._altecKioskKey);
      send(ws, buildInitEvent());
    }

    // Heartbeat — detect and clean up zombie connections
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const heartbeatTimer = setInterval(() => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL_MS);

    // Message handler
    ws.on('message', (raw) => handleMessage(ws, sessionId, raw));

    // Cleanup on close
    ws.on('close', () => {
      clearInterval(heartbeatTimer);
      removeSession(sessionId);
    });

    ws.on('error', (err) => {
      console.error(`[ws] session ${sessionId} error:`, err.message);
    });
  });

  return wss;
}

// ── Message protocol ──────────────────────────────────────────────────────────

function handleMessage(ws, sessionId, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    send(ws, { type: 'error', code: 'INVALID_JSON', message: 'Mensagem não é JSON válido.' });
    return;
  }

  switch (msg.type) {

    case 'ping':
      send(ws, { type: 'pong', timestamp: new Date().toISOString() });
      break;

    case 'subscribe':
    case 'unsubscribe': {
      const k = msg.kiosk;
      if (!k || !k.tenant_id || !k.establishment_id || !k.kiosk_id) {
        send(ws, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Campos kiosk.tenant_id, kiosk.establishment_id e kiosk.kiosk_id são obrigatórios.',
        });
        return;
      }

      // Tenant-scope check: fixed key must match requested tenant
      if (ws._altecTenantId !== '*' && ws._altecTenantId !== k.tenant_id) {
        send(ws, {
          type: 'error',
          code: 'FORBIDDEN',
          message: 'API key não tem acesso ao tenant informado.',
          tenant_id: k.tenant_id,
        });
        return;
      }

      const kioskKey = `${k.tenant_id}|${k.establishment_id}|${k.kiosk_id}`;
      if (!KNOWN_KIOSKS.has(kioskKey)) {
        send(ws, {
          type: 'error',
          code: 'NOT_FOUND',
          message: 'Kiosk não encontrado.',
          kiosk_key: kioskKey,
        });
        return;
      }

      if (msg.type === 'subscribe') {
        subscribe(sessionId, kioskKey);
        send(ws, { type: 'subscribed', kiosk_key: kioskKey, timestamp: new Date().toISOString() });
      } else {
        unsubscribe(sessionId, kioskKey);
        send(ws, { type: 'unsubscribed', kiosk_key: kioskKey, timestamp: new Date().toISOString() });
      }
      break;
    }

    default:
      send(ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Tipo de mensagem desconhecido: ${String(msg.type)}`,
      });
  }
}

/**
 * Builds the 'init' event pushed to the client after a kiosk-aware connection.
 * Contains the same configuration data available via GET /config, delivered
 * over WebSocket so the client does not need a separate HTTP request on startup.
 */
function buildInitEvent() {
  let configData;
  try {
    configData = getConfigData();
  } catch (err) {
    console.warn(`[ws] init config fallback after read error: ${err.message}`);
    configData = {};
  }

  return {
    type: 'init',
    config: {
      meta:                  configData.meta,
      branding:              configData.branding,
      establishment:         configData.establishment,
      media:                 configData.media,
      media_placement_rules: configData.media_placement_rules,
      payment_methods:       configData.payment_methods,
      totem_behavior:        configData.totem_behavior,
      features:              configData.features,
      localization:          configData.localization,
    },
  };
}

/** Safe send — only writes if the socket is open. */
function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

module.exports = { createWsServer };
