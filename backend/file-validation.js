'use strict';

const path = require('path');
const { TextDecoder } = require('util');

const MAX_BOOK_BYTES = 50 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;

function normalizedName(value, fallback) {
  const name = path.basename(String(value || fallback).replace(/[\\/]/g, '_')).replace(/[\r\n\0]/g, '').slice(0, 180);
  return name || fallback;
}

function validateBookFile({ mime, filename, bytes }) {
  const name = normalizedName(filename, 'virtual-book');
  const ext = path.extname(name).toLowerCase();
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { error: 'The uploaded file is empty.' };
  if (bytes.length > MAX_BOOK_BYTES) return { error: 'The uploaded book is larger than 50 MB.' };

  if (mime === 'application/pdf' && ext === '.pdf') {
    const header = bytes.subarray(0, Math.min(bytes.length, 1024)).toString('ascii');
    const tail = bytes.subarray(Math.max(0, bytes.length - 4096)).toString('latin1');
    if (!header.includes('%PDF-') || !tail.includes('%%EOF')) return { error: 'The uploaded file is not a complete PDF.' };
    return { name, mime, bytes: bytes.length };
  }

  if (mime === 'text/plain' && ext === '.txt') {
    if (bytes.includes(0)) return { error: 'The text book contains invalid binary data.' };
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return { error: 'The text book must use valid UTF-8 encoding.' }; }
    return { name, mime, bytes: bytes.length };
  }

  return { error: 'Only PDF and plain text (.txt) virtual books are supported.' };
}

function validateCoverFile({ mime, bytes }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { error: 'The cover image is empty.' };
  if (bytes.length > MAX_COVER_BYTES) return { error: 'The cover image is larger than 5 MB.' };
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if ((mime === 'image/png' && png) || (mime === 'image/jpeg' && jpeg) || (mime === 'image/webp' && webp)) return { mime, bytes: bytes.length };
  return { error: 'The cover content does not match a supported JPEG, PNG, or WEBP image.' };
}

module.exports = { MAX_BOOK_BYTES, MAX_COVER_BYTES, validateBookFile, validateCoverFile };
