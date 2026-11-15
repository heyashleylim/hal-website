// The spreadsheet import: reading an .xlsx with no library (site/assets/js/admin/xlsx.js) and the rules a row must pass
// (api/_lib/admin/emails.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const xlsx = require('../../site/assets/js/admin/xlsx.js');
const { importRow, publicScore } = require('../../api/_lib/admin/emails.js');

// A minimal zip (one deflated entry per file), enough for an .xlsx.
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8'), data = zlib.deflateRawSync(raw), n = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(zlib.crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(zlib.crc32(raw), 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, n, data); central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const dirBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...local, dirBytes, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const strings = ['Date', 'Campaign name', 'Subject', 'Body', 'Perf', 'Resend', 'Sent', 'Opened', 'Open rate', 'Clicked', 'Unsubscribed',
  'Launch &amp; open', '제목 &lt;1&gt;', '안녕하세요 님!\n \n본문 💝', 'Yes'];
const si = (s) => `<si><t xml:space="preserve">${s}</t></si>`;
const book = () => zip({
  'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="All emails data" sheetId="1" r:id="rId4"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="theme/theme1.xml"/><Relationship Id="rId4" Type="x" Target="worksheets/sheet7.xml"/></Relationships>',
  'xl/sharedStrings.xml': `<sst>${strings.map(si).join('')}<si><r><t>rich </t></r><r><t>text</t></r><rPh><t>ignored</t></rPh></si></sst>`,
  'xl/worksheets/sheet7.xml': '<worksheet><sheetData>' +
    '<row r="1">' + 'ABCDEFGHIJK'.split('').map((c, i) => `<c r="${c}1" s="1" t="s"><v>${i}</v></c>`).join('') + '</row>' +
    '<row r="2"><c r="A2" s="2"><v>45427.333333333336</v></c><c r="B2" t="s"><v>11</v></c><c r="C2" t="s"><v>12</v></c><c r="D2" t="s"><v>13</v></c>' +
      '<c r="E2"><f>IFERROR(1)</f><v>2.43</v></c><c r="F2" t="s"><v>14</v></c><c r="G2"><v>796.0</v></c><c r="H2"><v>167.0</v></c><c r="I2"><f t="shared" ref="I2:I4" si="1">H2/G2</f><v>0.2098</v></c><c r="J2"><v>36.0</v></c><c r="K2"><v>6.0</v></c></row>' +
    '<row r="3"><c r="A3"><v>46274.75</v></c><c r="B3" t="s"><v>15</v></c><c r="D3" t="inlineStr"><is><t>inline body</t></is></c><c r="G3"><v>167</v></c><c r="H3"><v>50</v></c><c r="J3"><v>0</v></c></row>' +
    '<row r="4"><c r="E4" t="str"><f>x</f><v></v></c><c r="I4" t="str"><v></v></c></row>' +
    '<row r="5"><c r="A5" t="s"><v>0</v></c><c r="B5" t="s"><v>11</v></c><c r="G5"><v>10</v></c></row>' +
    '</sheetData></worksheet>',
});

test('reads the first sheet of an .xlsx: text, numbers, formulas as their value', async () => {
  const rows = await xlsx.read(book());
  assert.equal(rows.length, 4);                                  // row 4 holds nothing
  assert.deepEqual(rows[0].cells.B, 'Campaign name');
  assert.deepEqual(rows[1], { row: 2, cells: { A: 45427.333333333336, B: 'Launch & open', C: '제목 <1>', D: '안녕하세요 님!\n \n본문 💝', E: 2.43, F: 'Yes', G: 796, H: 167, I: 0.2098, J: 36, K: 6 } });
  assert.equal(rows[2].cells.B, 'rich text');
  assert.equal(rows[2].cells.D, 'inline body');
});

test('rows become emails by column title; unreadable rows are listed, not imported', async () => {
  const { emails, problems } = xlsx.emails(await xlsx.read(book()));
  assert.deepEqual(emails, [
    { row: 2, sent_at: '2024-05-15T08:00', name: 'Launch & open', subject: '제목 <1>', body: '안녕하세요 님!\n \n본문 💝', sent: 796, opened: 167, clicked: 36, unsubscribed: 6 },
    { row: 3, sent_at: '2026-09-09T18:00', name: 'rich text', subject: '', body: 'inline body', sent: 167, opened: 50, clicked: 0, unsubscribed: 0 },
  ]);
  assert.deepEqual(problems, ['Row 5: the date is not readable']);
  assert.deepEqual(xlsx.emails([{ row: 1, cells: { A: 'Date', B: 'Subject' } }]).problems, ['The first row must have these column titles: Campaign name, Sent, Opened, Clicked.']);
});

test('not an .xlsx', async () => {
  await assert.rejects(xlsx.read(new TextEncoder().encode('Date,Campaign name\n').buffer), /not an \.xlsx/);
  await assert.rejects(xlsx.read(zip({ 'hello.txt': 'hi' })), /not an \.xlsx/);
});

test('spreadsheet dates are Seoul time', () => {
  assert.equal(xlsx.wallTime(45427.333333333336), '2024-05-15T08:00');
  assert.equal(xlsx.wallTime(46254.3263888889), '2026-08-20T07:50');
  assert.equal(xlsx.wallTime('2026-08-21 07:50:00'), '2026-08-21T07:50');
  assert.equal(xlsx.wallTime('yesterday'), null);
  const row = importRow({ sent_at: '2024-05-15T08:00', name: 'A', sent: 10, opened: 5, clicked: 1 }, 'Row 2');
  assert.equal(row.sent_at, '2024-05-14T23:00:00.000Z');
});

test('import rules: same date and name → same email; impossible numbers are refused', () => {
  const base = { sent_at: '2026-08-21T07:50', name: ' NSMB 1 - WAITLIST Launch ', subject: '제목', body: 'a\r\nb\n', resend: 'Maybe', sent: 247.0, opened: 120, clicked: 12, unsubscribed: '' };
  const row = importRow(base, 'Row 9');
  assert.deepEqual({ ...row, source_ref: null }, { source_ref: null, name: 'NSMB 1 - WAITLIST Launch', subject: '제목', body_text: 'a\nb', sent_at: '2026-08-20T22:50:00.000Z', sent: 247, opened: 120, clicked: 12, unsubscribed: 0 }); // Resend is not read
  assert.equal(importRow({ ...base, opened: 1, body: 'changed' }, 'Row 9').source_ref, row.source_ref);
  assert.notEqual(importRow({ ...base, sent_at: '2026-08-21T07:51' }, 'Row 9').source_ref, row.source_ref);
  assert.throws(() => importRow({ ...base, opened: 300 }, 'Row 9'), /Row 9: more opens or clicks than emails sent/);
  assert.throws(() => importRow({ ...base, sent_at: '21/08/2026' }, 'Row 9'), /Row 9: the date is not readable/);
  assert.throws(() => importRow({ ...base, name: '' }, 'Row 9'), /Row 9: campaign name is required/);
  assert.throws(() => importRow({ ...base, sent: -1 }, 'Row 9'), /Row 9: Sent must be/);
});

test('what the pages get for a score', () => {
  assert.deepEqual(publicScore({ state: 'small' }), { state: 'small' });
  assert.deepEqual(publicScore(undefined), { state: 'small' });
  assert.deepEqual(publicScore({ state: 'scored', score: 2.3456, level: 'top', compared: 30, open: { rate: 0.3, usual: 0.212345, z: 2.111 }, click: null, legacy: 1.23456 }),
    { state: 'scored', score: 2.35, level: 'top', compared: 30, open: { usual: 0.2123, z: 2.11 }, click: null, legacy: 1.23 });
});

// Translations written in a working session and saved with tools/emails/translations.js
test('a translated batch file is read block by block; a broken block names its email', () => {
  const { parseBatch, fingerprint } = require('../../tools/emails/translations.js');
  const text = '=====EMAIL import:abc:0123=====\n<subject>Hello 💝</subject>\n<body>\nLine 1\n\nLine 2 {{contact.first_name}}\n</body>\n\n=====EMAIL ac:77:4567=====\n<subject></subject>\n<body>\nOnly a body\n</body>\n';
  assert.deepEqual(parseBatch(text), [
    { key: 'import:abc:0123', subject: 'Hello 💝', body: 'Line 1\n\nLine 2 {{contact.first_name}}' },
    { key: 'ac:77:4567', subject: '', body: 'Only a body' },
  ]);
  assert.throws(() => parseBatch('=====EMAIL ac:1:x=====\n<subject>S</subject>\nno body tag'), /email ac:1:x/);
  assert.equal(fingerprint('제목', '본문'), require('../../api/_lib/emails/translate.js').fingerprint('제목', '본문'));
});
