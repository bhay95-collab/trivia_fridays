import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeMediaUrl,
  isSupportedMediaType,
  mediaRendererMarkup,
  normalizeMediaEntry,
} from '../media-utils.js';

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

test('only allows HTTPS media URLs', () => {
  assert.equal(isSafeMediaUrl('https://example.com/audio.mp3'), true);
  assert.equal(isSafeMediaUrl('http://example.com/audio.mp3'), false);
  assert.equal(isSafeMediaUrl('javascript:alert(1)'), false);
  assert.equal(isSafeMediaUrl('/local/file.png'), false);
});

test('renders only safe media and escapes attributes', () => {
  const markup = mediaRendererMarkup([
    { media_type: 'image', url: 'https://example.com/cat.png?x=1&y=2', caption: 'Cats & trivia' },
    { media_type: 'audio', url: 'javascript:alert(1)', caption: 'bad' },
  ]);

  assert.match(markup, /https:\/\/example\.com\/cat\.png\?x=1&amp;y=2/);
  assert.match(markup, /Cats &amp; trivia/);
  assert.doesNotMatch(markup, /javascript:alert/);
});
