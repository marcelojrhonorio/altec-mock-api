'use strict';

const path = require('path');
const fs = require('fs');
const { USE_IN_MEMORY_ORDERS } = require('../config');

const DYNAMIC_FILE = path.join(__dirname, '../../data/orders_dynamic.json');

/** In-memory map used as primary store (and sole store when USE_IN_MEMORY_ORDERS=true) */
const memoryStore = new Map();

/** Ensure the dynamic file exists and return its current content as a Map */
function _loadFromFile() {
  try {
    if (!fs.existsSync(DYNAMIC_FILE)) return new Map();
    const raw = fs.readFileSync(DYNAMIC_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();
    const map = new Map();
    for (const order of arr) {
      if (order && order.id) map.set(order.id, order);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Flush current in-memory store to file (best-effort, silent on error) */
function _persistToFile() {
  try {
    const arr = Array.from(memoryStore.values());
    fs.writeFileSync(DYNAMIC_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    console.warn('[orders-store] could not persist to file:', err.message);
  }
}

// Warm up memory from file on module load (only when file-backed)
if (!USE_IN_MEMORY_ORDERS) {
  const loaded = _loadFromFile();
  for (const [id, order] of loaded) {
    memoryStore.set(id, order);
  }
}

/**
 * Persist a new or updated order.
 * @param {object} order – full Order object (must have .id)
 */
function saveOrder(order) {
  memoryStore.set(order.id, order);
  if (!USE_IN_MEMORY_ORDERS) _persistToFile();
}

/**
 * Find a dynamically stored order by id.
 * @param {string} id
 * @returns {object|undefined}
 */
function findOrder(id) {
  return memoryStore.get(id);
}

module.exports = { saveOrder, findOrder };
