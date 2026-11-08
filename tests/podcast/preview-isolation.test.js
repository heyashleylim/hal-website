// Previews never touch production: own database (or no changes), own folder for uploaded files.
const test = require('node:test');
const assert = require('node:assert/strict');
const { separateFromProduction } = require('../../api/_lib/db.js');
const { blobRoot, mayDelete } = require('../../api/_lib/admin/podcast-content.js');

test('a preview counts as separate only with its own database', () => {
  assert.equal(separateFromProduction({ VERCEL_ENV: 'production' }), true);
  assert.equal(separateFromProduction({}), true); // local
  assert.equal(separateFromProduction({ VERCEL_ENV: 'preview' }), false);
  assert.equal(separateFromProduction({ VERCEL_ENV: 'preview', PODCAST_DATABASE_URL: ' ' }), false);
  assert.equal(separateFromProduction({ VERCEL_ENV: 'preview', PODCAST_DATABASE_URL: 'postgres://x' }), true);
});

test('preview uploads go under preview/ and a preview can only delete those', () => {
  assert.equal(blobRoot({ VERCEL_ENV: 'production' }), 'podcast');
  assert.equal(blobRoot({ VERCEL_ENV: 'preview' }), 'preview/podcast');
  assert.equal(mayDelete('podcast/nsmb/audio/a.mp3', { VERCEL_ENV: 'preview' }), false);
  assert.equal(mayDelete('preview/podcast/nsmb/audio/a.mp3', { VERCEL_ENV: 'preview' }), true);
  assert.equal(mayDelete('podcast/nsmb/audio/a.mp3', { VERCEL_ENV: 'production' }), true);
});
