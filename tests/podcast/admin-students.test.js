const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('../../api/_lib/admin-students.js');

test('CSV: quotes, commas, CRLF, BOM, blank lines, Korean', () => {
  const rows = parseCsv('﻿email,name,cohort\r\na@b.kr,"Kim, Jiyeon",1기\r\n\r\n"c@d.kr","He said ""hi""",nsmb-1기\n');
  assert.deepEqual(rows, [
    ['email', 'name', 'cohort'],
    ['a@b.kr', 'Kim, Jiyeon', '1기'],
    ['c@d.kr', 'He said "hi"', 'nsmb-1기'],
  ]);
});

test('CSV: semicolons and tabs (Excel exports) work too', () => {
  assert.deepEqual(parseCsv('email;name\nx@y.kr;Lee'), [['email', 'name'], ['x@y.kr', 'Lee']]);
  assert.deepEqual(parseCsv('email\tname\nx@y.kr\tLee'), [['email', 'name'], ['x@y.kr', 'Lee']]);
});
