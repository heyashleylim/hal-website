// Every button in the admin says what it does (data-tip, shown as a tooltip by admin.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function files(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) files(p, out);
    else if (/\.(html|js)$/.test(f.name)) out.push(p);
  }
  return out;
}

test('every admin button has a tooltip (data-tip)', () => {
  const root = path.join(__dirname, '../..');
  const missing = [];
  for (const file of [...files(path.join(root, 'site/admin')), ...files(path.join(root, 'site/assets/js/admin'))]) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<button\b[^>]*>/g)) {
      // the rail's menu button has its own label bubble (data-label)
      if (!/data-tip=|data-label=/.test(m[0])) missing.push(path.relative(root, file) + ': ' + m[0].slice(0, 80));
    }
  }
  assert.deepEqual(missing, []);
});
