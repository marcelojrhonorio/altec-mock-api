'use strict';

const { createHash } = require('crypto');

/**
 * Generates a deterministic ETag string for any serialisable content.
 * The tag is wrapped in double-quotes as required by RFC 7232.
 *
 * @param {string} prefix  – human-readable prefix (e.g. 'cfg', 'catalog')
 * @param {*} content      – any JSON-serialisable value
 * @returns {string}       – e.g. '"cfg-a1b2c3d4"'
 */
function generateETag(prefix, content) {
  const hash = createHash('md5')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 8);
  return `"${prefix}-${hash}"`;
}

/**
 * Returns true when the incoming If-None-Match header matches the current ETag.
 * Handles both quoted and unquoted values defensively.
 *
 * @param {string} ifNoneMatch  – value of the If-None-Match request header
 * @param {string} etag         – current ETag (quoted)
 * @returns {boolean}
 */
function isNotModified(ifNoneMatch, etag) {
  if (!ifNoneMatch || !etag) return false;
  // Strip surrounding quotes for a normalised comparison
  const normalise = (s) => s.replace(/^"|"$/g, '');
  return normalise(ifNoneMatch) === normalise(etag);
}

module.exports = { generateETag, isNotModified };
