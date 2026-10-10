'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidDatabaseId, isValidUnsignedInteger } = require('./request-validation');

test('accepts positive PostgreSQL bigint identifiers only', () => {
  assert.equal(isValidDatabaseId('1'), true);
  assert.equal(isValidDatabaseId('9223372036854775807'), true);
  for (const value of ['', '0', '-1', '01', '1.5', '1e3', '9223372036854775808', 'a']) assert.equal(isValidDatabaseId(value), false);
});

test('accepts bounded unsigned integer query values without partial parsing', () => {
  assert.equal(isValidUnsignedInteger('0', 100), true);
  assert.equal(isValidUnsignedInteger('100', 100), true);
  for (const value of ['-1', '1x', '01', '101', '1.5', '']) assert.equal(isValidUnsignedInteger(value, 100), false);
});
