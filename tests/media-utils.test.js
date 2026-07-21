import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMediaEntry, isSupportedMediaType } from '../media-utils.js';

test('normalizes media entries and preserves captions', () => {
  const entry = normalizeMediaEntry({ media_type: 'Image', url: 'https://example.com/cat.png', caption: 'A cat' });

  assert.equal(entry.media_type, 'image');
  assert.equal(entry.url, 'https://example.com/cat.png');
  assert.equal(entry.caption, 'A cat');
  assert.equal(entry.source_type, 'url');
});

test('rejects unsupported media types', () => {
  assert.equal(isSupportedMediaType('document'), false);
  assert.equal(isSupportedMediaType('audio'), true);
  assert.equal(isSupportedMediaType('video'), true);
});
