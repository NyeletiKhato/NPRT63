'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBookFile, validateCoverFile, MAX_BOOK_BYTES } = require('./file-validation');

test('accepts a complete PDF with a valid extension and MIME type', () => {
  const result = validateBookFile({ mime: 'application/pdf', filename: 'story.pdf', bytes: Buffer.from('%PDF-1.7\ncontent\n%%EOF\n') });
  assert.deepEqual(result, { name: 'story.pdf', mime: 'application/pdf', bytes: 23 });
});

test('rejects a truncated or mislabeled PDF', () => {
  assert.match(validateBookFile({ mime: 'application/pdf', filename: 'story.pdf', bytes: Buffer.from('%PDF-1.7\ncontent') }).error, /complete PDF/);
  assert.match(validateBookFile({ mime: 'text/plain', filename: 'story.pdf', bytes: Buffer.from('plain text') }).error, /Only PDF/);
});

test('validates UTF-8 plain text and rejects binary or invalid UTF-8', () => {
  assert.equal(validateBookFile({ mime: 'text/plain', filename: 'story.txt', bytes: Buffer.from('Hello, library.\n') }).error, undefined);
  assert.match(validateBookFile({ mime: 'text/plain', filename: 'story.txt', bytes: Buffer.from([0x61, 0]) }).error, /binary/);
  assert.match(validateBookFile({ mime: 'text/plain', filename: 'story.txt', bytes: Buffer.from([0xc3, 0x28]) }).error, /UTF-8/);
});

test('caps book uploads and keeps paths out of stored display names', () => {
  assert.match(validateBookFile({ mime: 'text/plain', filename: 'large.txt', bytes: Buffer.alloc(MAX_BOOK_BYTES + 1) }).error, /50 MB/);
  const result = validateBookFile({ mime: 'text/plain', filename: '..\\..\\folder\\story.txt', bytes: Buffer.from('ok') });
  assert.equal(result.name.includes('\\'), false);
  assert.equal(result.name.includes('/'), false);
});

test('checks cover bytes against the declared image type', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  assert.equal(validateCoverFile({ mime: 'image/png', bytes: png }).error, undefined);
  assert.equal(validateCoverFile({ mime: 'image/jpeg', bytes: jpeg }).error, undefined);
  assert.equal(validateCoverFile({ mime: 'image/webp', bytes: webp }).error, undefined);
  assert.match(validateCoverFile({ mime: 'image/png', bytes: jpeg }).error, /does not match/);
});

test('rejects empty, oversized, and unsupported cover uploads', () => {
  assert.match(validateCoverFile({ mime: 'image/png', bytes: Buffer.alloc(0) }).error, /empty/);
  assert.match(validateCoverFile({ mime: 'image/png', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }).error, /larger than 5 MB/);
  assert.match(validateCoverFile({ mime: 'image/svg+xml', bytes: Buffer.from('<svg/>') }).error, /does not match/);
});

test('rejects empty, extension-mismatched, and unsupported digital books', () => {
  assert.match(validateBookFile({ mime: 'text/plain', filename: 'empty.txt', bytes: Buffer.alloc(0) }).error, /empty/);
  assert.match(validateBookFile({ mime: 'text/plain', filename: 'wrong.pdf', bytes: Buffer.from('plain text') }).error, /Only PDF/);
  assert.match(validateBookFile({ mime: 'application/epub+zip', filename: 'book.epub', bytes: Buffer.from('PK') }).error, /Only PDF and plain text/);
});
