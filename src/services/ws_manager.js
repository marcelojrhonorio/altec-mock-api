'use strict';

const { randomBytes } = require('crypto');

/**
 * In-memory registry of active WebSocket sessions.
 * sessionId → { ws, tenantId, subscriptions: Set<kioskKey> }
 *
 * kioskKey format: "tenant_id|establishment_id|kiosk_id"
 */
const sessions = new Map();

/**
 * Register a new WebSocket session.
 * @param {import('ws').WebSocket} ws
 * @param {string} tenantId  – tenant bound to the api_key used on connect ('*' for wildcard)
 * @returns {string} sessionId
 */
function addSession(ws, tenantId) {
  const sessionId = 'ws_' + randomBytes(6).toString('hex');
  sessions.set(sessionId, { ws, tenantId, subscriptions: new Set() });
  return sessionId;
}

/** Remove a session (called on ws close). */
function removeSession(sessionId) {
  sessions.delete(sessionId);
}

/** Add a kioskKey to the session's subscription set. */
function subscribe(sessionId, kioskKey) {
  const session = sessions.get(sessionId);
  if (session) session.subscriptions.add(kioskKey);
}

/** Remove a kioskKey from the session's subscription set. */
function unsubscribe(sessionId, kioskKey) {
  const session = sessions.get(sessionId);
  if (session) session.subscriptions.delete(kioskKey);
}

/**
 * Broadcast a JSON event to matching sessions.
 *
 * Scope rules (evaluated in priority order):
 *   scope.kioskKey  → sessions subscribed to that specific kiosk
 *   scope.tenantId  → sessions whose tenantId matches (or is '*')
 *   (empty scope)   → all open sessions
 *
 * @param {{ kioskKey?: string, tenantId?: string }} scope
 * @param {object} event  – must be JSON-serialisable
 * @returns {number} number of sessions the event was delivered to
 */
function broadcast(scope, event) {
  const payload = JSON.stringify(event);
  let count = 0;

  for (const [, session] of sessions) {
    const { ws, tenantId, subscriptions } = session;

    // Skip closed/closing connections
    if (ws.readyState !== 1 /* WebSocket.OPEN */) continue;

    let matches = false;
    if (scope.kioskKey) {
      matches = subscriptions.has(scope.kioskKey);
    } else if (scope.tenantId) {
      matches = tenantId === scope.tenantId || tenantId === '*';
    } else {
      matches = true;
    }

    if (matches) {
      ws.send(payload);
      count++;
    }
  }

  return count;
}

/** Number of currently registered sessions (for diagnostics). */
function sessionCount() {
  return sessions.size;
}

module.exports = { addSession, removeSession, subscribe, unsubscribe, broadcast, sessionCount };
