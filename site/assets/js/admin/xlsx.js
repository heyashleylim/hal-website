/* Reads an .xlsx spreadsheet in the browser, with no library: an .xlsx file is a zip of XML files.
   Used by /admin/emails/sync to import the emails spreadsheet; also runs in Node for tests/emails/xlsx.test.js.

   AdminXlsx.read(arrayBuffer)  → Promise of the first sheet as rows: [{ row: 2, cells: { A: 45427.33, B: 'text' } }, …]
                                  (numbers as numbers, text as text, formulas as their last calculated value)
   AdminXlsx.emails(rows)       → { emails: [{ row, sent_at: '2024-05-15T08:00', name, subject, body, resend, sent,
                                  opened, clicked, unsubscribed }], problems: ['Row 7: …'] } for the emails spreadsheet
                                  (columns found by their header: Date, Campaign name, Subject, Body, Resend, Sent,
                                  Opened, Clicked, Unsubscribed; Perf and the rates are ignored: the admin computes them). */
(function (root) {
  var utf8 = new TextDecoder('utf-8');

  function inflate(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  // The zip's files: name → function returning a Promise of its text.
  function unzip(buffer) {
    var bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('This is not an .xlsx file.');
    var count = view.getUint16(end + 10, true), at = view.getUint32(end + 16, true), files = {};
    for (var n = 0; n < count; n++) {
      if (view.getUint32(at, true) !== 0x02014b50) throw new Error('This .xlsx file is damaged.');
      var method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
      var nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
      var local = view.getUint32(at + 42, true);
      var name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));
      files[name] = (function (method, size, local) {
        return function () {
          var start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
          var data = bytes.subarray(start, start + size);
          if (method === 0) return Promise.resolve(utf8.decode(data));
          if (method !== 8) return Promise.reject(new Error('This .xlsx file uses a compression this page cannot read.'));
          return inflate(data).then(function (out) { return utf8.decode(out); });
        };
      })(method, size, local);
      at += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e.charAt(0) !== '#') return ENTITIES[e];
      return String.fromCodePoint(e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }).replace(/_x000D_/g, '');
  }

  // The text inside an <si> or <is> element: every <t> run, without phonetic guides.
  function runs(xml) {
    var out = '';
    xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (m, t) { out += t; return m; });
    return decode(out);
  }

  function attr(tag, name) {
    var m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag);
    return m ? m[1] : null;
  }

  function read(buffer) {
    var files;
    try { files = unzip(buffer); } catch (err) { return Promise.reject(err); }
    if (!files['xl/workbook.xml']) return Promise.reject(new Error('This is not an .xlsx file (save the sheet as Excel .xlsx).'));
    var get = function (name) { return files[name] ? files[name]() : Promise.resolve(''); };
    return Promise.all([get('xl/workbook.xml'), get('xl/_rels/workbook.xml.rels'), get('xl/sharedStrings.xml')]).then(function (parts) {
      // first sheet of the workbook → its file
      var sheet = /<sheet\b[^>]*>/.exec(parts[0]);
      var rid = sheet && attr(sheet[0], 'r:id'), target = 'worksheets/sheet1.xml';
      (parts[1].match(/<Relationship\b[^>]*>/g) || []).forEach(function (rel) { if (attr(rel, 'Id') === rid) target = attr(rel, 'Target'); });
      var path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target;
      var strings = (parts[2].match(/<si\b[^>]*>[\s\S]*?<\/si>|<si\/>/g) || []).map(runs);
      return get(path).then(function (xml) {
        if (!xml) throw new Error('The first sheet of this file could not be read.');
        var rows = [];
        xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, function (m, head, inner) {
          var cells = {}, any = false;
          inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (c, tag, body) {
            var ref = attr(tag, 'r'), type = attr(tag, 't');
            if (!ref || body == null) return c;
            var v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body), value;
            if (type === 'inlineStr') value = runs(body);
            else if (!v) return c;
            else if (type === 's') value = strings[Number(v[1])];
            else if (type === 'str' || type === 'e') value = decode(v[1]);
            else if (type === 'b') value = v[1] === '1';
            else value = Number(v[1]);
            if (value === '' || value == null || (typeof value === 'number' && isNaN(value))) return c;
            cells[ref.replace(/\d+/g, '')] = value;
            any = true;
            return c;
          });
          if (any) rows.push({ row: Number(attr(head, 'r')) || rows.length + 1, cells: cells });
          return m;
        });
        return rows;
      });
    });
  }

  // A spreadsheet date (days since 30 Dec 1899, as the sheet shows it) → "YYYY-MM-DDTHH:MM".
  function wallTime(value) {
    if (typeof value === 'number' && value > 20000 && value < 80000) {
      var d = new Date(Math.round(value * 1440) * 60000 - 25569 * 86400000);
      return d.toISOString().slice(0, 16);
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value || '').trim());
    return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + (m[4] || '00') + ':' + (m[5] || '00') : null;
  }

  var HEADERS = { date: 'sent_at', 'campaign name': 'name', subject: 'subject', body: 'body', resend: 'resend', sent: 'sent', opened: 'opened', clicked: 'clicked', unsubscribed: 'unsubscribed' };
  var REQUIRED = ['sent_at', 'name', 'sent', 'opened', 'clicked'];

  function emails(rows) {
    var problems = [], out = [];
    if (!rows.length) return { emails: out, problems: ['The sheet is empty.'] };
    var columns = {}; // field → column letter
    Object.keys(rows[0].cells).forEach(function (col) {
      var field = HEADERS[String(rows[0].cells[col]).trim().toLowerCase()];
      if (field && !columns[field]) columns[field] = col;
    });
    var missing = REQUIRED.filter(function (f) { return !columns[f]; });
    if (missing.length) {
      var label = { sent_at: 'Date', name: 'Campaign name', sent: 'Sent', opened: 'Opened', clicked: 'Clicked' };
      return { emails: out, problems: ['The first row must have these column titles: ' + missing.map(function (f) { return label[f]; }).join(', ') + '.'] };
    }
    rows.slice(1).forEach(function (r) {
      var get = function (f) { return columns[f] ? r.cells[columns[f]] : undefined; };
      var name = get('name'), when = get('sent_at');
      if (name == null && when == null) return; // rows holding only formulas
      var sentAt = wallTime(when);
      if (!sentAt) { problems.push('Row ' + r.row + ': the date is not readable'); return; }
      if (name == null || String(name).trim() === '') { problems.push('Row ' + r.row + ': no campaign name'); return; }
      var n = function (f) { var v = get(f); return v == null ? 0 : Number(v); };
      if ([n('sent'), n('opened'), n('clicked'), n('unsubscribed')].some(function (v) { return isNaN(v) || v < 0; })) { problems.push('Row ' + r.row + ': Sent, Opened, Clicked and Unsubscribed must be numbers'); return; }
      var s = function (f) { var v = get(f); return v == null ? '' : String(v); };
      out.push({ row: r.row, sent_at: sentAt, name: String(name).trim(), subject: s('subject'), body: s('body'), resend: s('resend'), sent: n('sent'), opened: n('opened'), clicked: n('clicked'), unsubscribed: n('unsubscribed') });
    });
    return { emails: out, problems: problems };
  }

  var api = { read: read, emails: emails, wallTime: wallTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdminXlsx = api;
})(typeof window !== 'undefined' ? window : globalThis);
