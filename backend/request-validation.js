'use strict';

const MAX_BIGINT = 9223372036854775807n;

function isValidDatabaseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) return false;
  return BigInt(value) <= MAX_BIGINT;
}

function isValidUnsignedInteger(value, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max;
}

module.exports = { isValidDatabaseId, isValidUnsignedInteger };
