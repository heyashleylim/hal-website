/* Podcast admin: Students page — people across all shows, their enrolments, bulk actions, CSV import/export,
   and Sync from ActiveCampaign. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var students = [], cohorts = [], shows = [], selected = new Set(), current = null;
  var STATE = {
    active: '<span class="badge badge--ok">Active</span>',
    'not-enrolled': '<span class="badge badge--warn">Not enrolled</span>',
    revoked: '<span class="badge badge--warn">Revoked</span>',
    expired: '<span class="badge">Access ended</span>',
  };
  var STATE_TEXT = { active: 'Active', 'not-enrolled': 'Not enrolled', revoked: 'Revoked', expired: 'Access ended' };

  function show(id) {
    ['sync', 'editor', 'importer', 'detail'].forEach(function (p) { $(p).hidden = p !== id; });
    if (id) $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { $(b.dataset.close).hidden = true; }); });
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      navigator.clipboard.writeText($(b.dataset.copy).value).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); });
    });
  });

  // ---------- data ----------
  function load() {
    return Admin.get('students').then(function (r) {
      students = r.students; cohorts = r.cohorts; shows = r.shows;
      fillSelects();
      var ids = new Set(students.map(function (s) { return s.id; }));
      selected.forEach(function (id) { if (!ids.has(id)) selected.delete(id); });
      render();
    }).catch(function (err) { $('list').innerHTML = '<p class="is-error">' + Admin.esc(err.message) + '</p>'; });
  }

  function cohortLabel(c) { return (shows.length > 1 ? c.show_title + ' · ' : '') + c.name; }

  function fillSelects() {
    var keepShow = $('f-show').value;
    $('f-show').innerHTML = '<option value="">All</option>' + shows.map(function (x) { return '<option value="' + x.id + '">' + Admin.esc(x.title) + '</option>'; }).join('');
    $('f-show').value = keepShow;
    document.querySelectorAll('[data-cohorts]').forEach(function (sel) {
      var keep = sel.value, kind = sel.dataset.cohorts;
      var head = kind === 'filter' ? '<option value="">All</option>' : kind === 'none' ? '<option value="">Not now</option>' : '';
      var list = kind === 'filter' && $('f-show').value ? cohorts.filter(function (c) { return String(c.show_id) === $('f-show').value; }) : cohorts;
      sel.innerHTML = head + list.map(function (c) { return '<option value="' + c.id + '">' + Admin.esc(cohortLabel(c)) + '</option>'; }).join('');
      sel.value = keep;
      if (sel.value !== keep && kind !== 'filter' && kind !== 'none' && list.length) sel.selectedIndex = 0;
    });
  }

  function behind(s) { return s.state === 'active' && s.downloaded < s.released; }

  function filtered() {
    var q = $('f-q').value.trim().toLowerCase(), sh = $('f-show').value, c = $('f-cohort').value, st = $('f-state').value, ls = $('f-listen').value;
    return students.filter(function (s) {
      if (q && (s.email + ' ' + s.name).toLowerCase().indexOf(q) < 0) return false;
      if (sh && !s.enrollments.some(function (e) { return String(e.show.id) === sh; })) return false;
      if (c && !s.enrollments.some(function (e) { return String(e.cohort.id) === c; })) return false;
      if (st && s.state !== st) return false;
      if (ls === 'never' && s.first_seen_at) return false;
      if (ls === 'subscribed' && !s.first_seen_at) return false;
      if (ls === 'behind' && !behind(s)) return false;
      return true;
    });
  }

  function enrolChips(s) {
    if (!s.enrollments.length) return '<span class="muted">–</span>';
    return s.enrollments.map(function (e) {
      var cls = e.state === 'active' ? 'badge--ok' : e.state === 'revoked' ? 'badge--warn' : '';
      return '<span class="badge ' + cls + '" title="' + Admin.esc(STATE_TEXT[e.state] || e.state) + '">' + Admin.esc((shows.length > 1 ? e.show.title + ' · ' : '') + e.cohort.name) + '</span>';
    }).join(' ');
  }

  // ---------- list ----------
  function render() {
    var rows = filtered();
    $('count').textContent = rows.length + ' of ' + students.length + ' student' + (students.length === 1 ? '' : 's');
    if (!rows.length) {
      $('list').innerHTML = '<p class="admin-empty">' + (students.length ? 'No student matches these filters.' : 'No students yet. Sync from ActiveCampaign, add one, or import a CSV.') + '</p>';
    } else {
      var allChecked = rows.every(function (s) { return selected.has(s.id); });
      $('list').innerHTML = '<table class="admin-table"><thead><tr><th><input type="checkbox" id="check-all" aria-label="Select all shown"' + (allChecked ? ' checked' : '') + '></th>' +
        '<th>Student</th><th>Enrolments</th><th>Access</th><th>Subscribed</th><th>Downloaded</th><th>Apps</th><th>Until</th></tr></thead><tbody>' +
        rows.map(function (s) {
          return '<tr data-id="' + s.id + '"><td><input type="checkbox" data-check aria-label="Select ' + Admin.esc(s.email) + '"' + (selected.has(s.id) ? ' checked' : '') + '></td>' +
            '<td><button class="linkish" type="button" data-open>' + Admin.esc(s.name || s.email) + '</button>' + (s.name ? '<div class="muted small">' + Admin.esc(s.email) + '</div>' : '') + '</td>' +
            '<td class="chips">' + enrolChips(s) + '</td><td>' + STATE[s.state] + '</td>' +
            '<td class="num">' + (s.first_seen_at ? Admin.kst(s.first_seen_at, false) : '<span class="muted">Not yet</span>') + '</td>' +
            '<td class="num">' + s.downloaded + ' / ' + s.released + (behind(s) ? ' <span class="badge badge--warn">behind</span>' : '') + '</td>' +
            '<td class="small">' + (s.apps.length ? Admin.esc(s.apps.join(', ')) : '–') + '</td>' +
            '<td class="num">' + Admin.lastDay(s.expires_at) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    $('bulk').hidden = !selected.size;
    $('bulk-count').textContent = selected.size + ' selected';
  }

  ['f-q', 'f-cohort', 'f-state', 'f-listen'].forEach(function (id) { $(id).addEventListener('input', render); });
  $('f-show').addEventListener('input', function () { $('f-cohort').value = ''; fillSelects(); render(); });

  $('list').addEventListener('click', function (ev) {
    if (ev.target.id === 'check-all') {
      filtered().forEach(function (s) { if (ev.target.checked) selected.add(s.id); else selected.delete(s.id); });
      return render();
    }
    var tr = ev.target.closest('tr[data-id]');
    if (!tr) return;
    var id = Number(tr.dataset.id);
    if (ev.target.matches('[data-check]')) { if (ev.target.checked) selected.add(id); else selected.delete(id); return render(); }
    if (ev.target.closest('[data-open]')) openDetail(id);
  });

  // ---------- bulk ----------
  function bulk(action, data, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    Admin.post(action, Object.assign({ ids: Array.from(selected) }, data || {})).then(function (r) {
      selected.clear();
      if (r.skipped) alert(r.added + ' enrolled; ' + r.skipped + ' were already in that cohort.');
      return load();
    }).catch(function (err) { alert(err.message); });
  }
  $('bulk-enrol').addEventListener('click', function () {
    var c = $('bulk-cohort');
    if (!c.value) return;
    bulk('students-enroll', { cohort_id: c.value }, 'Enrol ' + selected.size + ' student(s) in ' + c.options[c.selectedIndex].text + '?');
  });
  $('bulk-revoke').addEventListener('click', function () { bulk('students-status', { status: 'revoked' }, 'Revoke all access (every show) for ' + selected.size + ' student(s)? Their podcasts stop working within 5 minutes.'); });
  $('bulk-restore').addEventListener('click', function () { bulk('students-status', { status: 'active' }); });
  $('bulk-clear').addEventListener('click', function () { selected.clear(); render(); });

  // ---------- add / edit ----------
  var form = $('form'), fout = form.querySelector('.admin-form__result');
  function openEditor(s) {
    form.reset(); Admin.say(fout, '');
    form.id.value = s ? s.id : '';
    form.email.value = s ? s.email : '';
    form.name.value = s ? s.name : '';
    form.notes.value = s ? s.notes : '';
    form.querySelector('[data-new-only]').hidden = Boolean(s);
    $('editor-title').textContent = s ? 'Edit ' + (s.name || s.email) : 'Add student';
    show('editor');
    form.email.focus({ preventScroll: true });
  }
  $('add').addEventListener('click', function () { openEditor(null); });
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var data = { id: form.id.value || undefined, email: form.email.value, name: form.name.value, notes: form.notes.value, cohort_id: form.id.value ? undefined : form.cohort_id.value };
    var btn = form.querySelector('[type=submit]');
    btn.disabled = true; Admin.say(fout, 'Saving…');
    Admin.post('student-save', data).then(function (r) {
      $('editor').hidden = true;
      return load().then(function () { openDetail(r.student.id); });
    }).catch(function (err) { Admin.say(fout, err.message, true); }).then(function () { btn.disabled = false; });
  });

  // ---------- detail ----------
  function fact(label, value) { return '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>'; }

  function eventText(e) {
    var what = e.kind === 'feed' ? 'Podcast app checked the feed' :
      'Downloaded ' + (e.episode_kind === 'bonus' ? 'bonus' : e.number ? 'module ' + e.number : 'an episode') + (e.title ? ' · ' + Admin.esc(e.title) : '');
    return '<li><span class="num">' + Admin.kst(e.at) + '</span> ' + (e.show_title && shows.length > 1 ? '<strong>' + Admin.esc(e.show_title) + '</strong> · ' : '') + what +
      (e.app ? ' <span class="muted">· ' + Admin.esc(e.app) + (e.country ? ', ' + Admin.esc(e.country) : '') + '</span>' : '') + '</li>';
  }

  function enrollmentRows(s) {
    if (!s.enrollments.length) return '<p class="muted">Not enrolled in any cohort: their page shows nothing to subscribe to.</p>';
    return '<table class="admin-table"><thead><tr><th>Show</th><th>Cohort</th><th>Status</th><th>Own start date</th><th>Listen until</th><th>Added</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      s.enrollments.map(function (e) {
        return '<tr data-enrollment="' + e.id + '"><td>' + Admin.esc(e.show.title) + '</td><td>' + Admin.esc(e.cohort.name) + '</td><td>' + STATE[e.state] + '</td>' +
          '<td><input type="date" data-start value="' + Admin.esc(e.start_override || '') + '" aria-label="Own start date"></td>' +
          '<td><input type="date" data-until value="' + (e.expires_override ? Admin.kstParts(new Date(new Date(e.expires_override).getTime() - 1)).date : '') + '" aria-label="Last day of access (empty: cohort rule)">' +
          (e.expires_override ? '' : ' <span class="muted small">' + Admin.lastDay(e.expires_at) + '</span>') + '</td>' +
          '<td class="small">' + Admin.kst(e.created_at, false) + ' · ' + Admin.esc(e.source) + '</td>' +
          '<td><div class="admin-actions"><button class="btn-ghost" type="button" data-en-save>Save dates</button>' +
          '<button class="btn-ghost" type="button" data-en-status="' + (e.status === 'revoked' ? 'active' : 'revoked') + '">' + (e.status === 'revoked' ? 'Restore' : 'Revoke') + '</button>' +
          '<button class="btn-danger" type="button" data-en-delete>Remove</button></div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function openDetail(id) {
    show('detail');
    Admin.say($('d-out'), 'Loading…');
    return Admin.get('student', { id: id }).then(function (r) {
      var s = r.student; current = s;
      $('detail-title').textContent = s.name ? s.name + ' · ' + s.email : s.email;
      $('d-revoke').textContent = s.status === 'revoked' ? 'Restore access' : 'Revoke all access';
      $('d-link').value = s.page_url;
      var n = r.networks || {};
      $('d-facts').innerHTML =
        fact('Access', STATE[s.state] + (s.revoked_at ? ' <span class="muted">since ' + Admin.kst(s.revoked_at, false) + '</span>' : '')) +
        s.shows.map(function (x) {
          return fact(Admin.esc(x.title), STATE[x.state] + ' · ' + x.released + ' released' + (x.next_release ? ' · next ' + Admin.kst(x.next_release) : '') + (x.expires_at ? ' · until ' + Admin.lastDay(x.expires_at) : ''));
        }).join('') +
        fact('Downloaded', s.downloaded + ' episode' + (s.downloaded === 1 ? '' : 's')) +
        fact('Subscribed', s.first_seen_at ? Admin.kst(s.first_seen_at) : 'Not yet') +
        fact('Last app activity', s.last_seen_at ? Admin.kst(s.last_seen_at) : '–') +
        fact('Apps', s.apps.length ? Admin.esc(s.apps.join(', ')) : '–') +
        fact('Download networks', (n.networks_7d || 0) + ' in the last 7 days · ' + (n.networks_all || 0) + ' in total' + (n.countries && n.countries.length ? ' · ' + Admin.esc(n.countries.join(', ')) : '') +
          (n.networks_7d > 6 ? ' <span class="badge badge--warn">possible link sharing</span>' : '')) +
        fact('Added', Admin.kst(s.created_at, false) + (s.ac_contact_id ? ' · AC contact ' + Admin.esc(s.ac_contact_id) : '')) +
        (s.notes ? fact('Notes', Admin.esc(s.notes)) : '');
      $('d-enrollments').innerHTML = enrollmentRows(s);
      $('d-events').innerHTML = r.events.length ? r.events.map(eventText).join('') : '<li class="muted">Nothing yet: the student hasn’t added a podcast to an app.</li>';
      $('d-ac').innerHTML = r.outbox.length ? '<ol class="timeline">' + r.outbox.map(function (o) {
        return '<li><span class="num">' + Admin.kst(o.created_at) + '</span> ' + Admin.esc(o.op) + ' ' + Admin.esc(JSON.stringify(o.payload)) + ' · ' + Admin.esc(o.status) + (o.last_error ? ' <span class="is-error">' + Admin.esc(o.last_error) + '</span>' : '') + '</li>';
      }).join('') + '</ol>' : '<p class="muted">No automatic updates yet (phase 5).</p>';
      $('d-history').innerHTML = r.history.length ? r.history.map(function (h) {
        return '<li><span class="num">' + Admin.kst(h.at) + '</span> ' + Admin.esc(h.action) + ' <span class="muted">by ' + Admin.esc(h.admin) + '</span></li>';
      }).join('') : '<li class="muted">No changes recorded.</li>';
      Admin.say($('d-out'), '');
    }).catch(function (err) { Admin.say($('d-out'), err.message, true); });
  }

  function refreshDetail(message) {
    return load().then(function () { return openDetail(current.id); }).then(function () { if (message) Admin.say($('d-out'), message); });
  }

  $('d-enrollments').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-enrollment]');
    if (!tr || !current) return;
    var id = tr.dataset.enrollment;
    if (ev.target.closest('[data-en-save]')) {
      Admin.post('enrollment-save', { id: id, start_override: tr.querySelector('[data-start]').value, access_until: tr.querySelector('[data-until]').value })
        .then(function () { return refreshDetail('Dates saved.'); }).catch(function (err) { Admin.say($('d-out'), err.message, true); });
    } else if (ev.target.closest('[data-en-status]')) {
      var status = ev.target.closest('[data-en-status]').dataset.enStatus;
      if (status === 'revoked' && !confirm('Revoke this enrolment? If it was their only one in this show, the show stops working for them within 5 minutes.')) return;
      Admin.post('enrollments-status', { ids: [id], status: status }).then(function () { return refreshDetail(); }).catch(function (err) { Admin.say($('d-out'), err.message, true); });
    } else if (ev.target.closest('[data-en-delete]')) {
      if (!confirm('Remove this enrolment? To keep a record, use Revoke instead.')) return;
      Admin.post('enrollment-delete', { id: id }).then(function () { return refreshDetail(); }).catch(function (err) { Admin.say($('d-out'), err.message, true); });
    }
  });

  $('d-enrol').addEventListener('click', function () {
    var c = $('d-enrol-cohort');
    if (!current || !c.value) return;
    Admin.post('enrollment-save', { student_id: current.id, cohort_id: c.value }).then(function () { return refreshDetail('Enrolled in ' + c.options[c.selectedIndex].text + '.'); })
      .catch(function (err) { Admin.say($('d-out'), err.message, true); });
  });

  $('d-edit').addEventListener('click', function () { if (current) openEditor(current); });
  $('d-reset').addEventListener('click', function () {
    if (!current || !confirm('Give ' + current.email + ' a new personal link? The old link and every podcast already added to their apps stop working; they must subscribe again with the new link.')) return;
    Admin.post('student-reset-link', { id: current.id }).then(function () { return refreshDetail('New link created. Send it to the student (ActiveCampaign will do it automatically from phase 5).'); })
      .catch(function (err) { Admin.say($('d-out'), err.message, true); });
  });
  $('d-revoke').addEventListener('click', function () {
    if (!current) return;
    var revoke = current.status !== 'revoked';
    if (revoke && !confirm('Revoke all access (every show) for ' + current.email + '? Their podcasts stop working within 5 minutes.')) return;
    Admin.post('students-status', { ids: [current.id], status: revoke ? 'revoked' : 'active' }).then(function () { return refreshDetail(); })
      .catch(function (err) { Admin.say($('d-out'), err.message, true); });
  });
  $('d-delete').addEventListener('click', function () {
    if (!current || !confirm('Delete ' + current.email + ', their enrolments and listening history? To only stop their access, use Revoke instead. This cannot be undone.')) return;
    Admin.post('student-delete', { id: current.id }).then(function () { $('detail').hidden = true; current = null; return load(); })
      .catch(function (err) { Admin.say($('d-out'), err.message, true); });
  });

  // ---------- sync from ActiveCampaign ----------
  $('sync-open').addEventListener('click', function () { Admin.say($('sync-out'), ''); $('sync-report').innerHTML = ''; show('sync'); });
  document.querySelectorAll('[data-sync]').forEach(function (b) {
    b.addEventListener('click', function () {
      var scope = b.dataset.sync;
      document.querySelectorAll('[data-sync]').forEach(function (x) { x.disabled = true; });
      Admin.say($('sync-out'), 'Syncing with ActiveCampaign… (this can take a minute with many students)');
      $('sync-report').innerHTML = '';
      Admin.post('ac-sync', { scope: scope }).then(function (r) {
        Admin.say($('sync-out'), r.new_students + ' new student' + (r.new_students === 1 ? '' : 's') + ', ' + r.new_enrolments + ' new enrolment' + (r.new_enrolments === 1 ? '' : 's') + ', ' + r.already + ' already here.');
        var html = r.cohorts.length ? '<table class="admin-table"><thead><tr><th>Show</th><th>Cohort</th><th>AC tag</th><th>In AC</th><th>Added</th><th>Problem</th></tr></thead><tbody>' +
          r.cohorts.map(function (c) {
            return '<tr><td>' + Admin.esc(c.show) + '</td><td>' + Admin.esc(c.name) + '</td><td><code>' + Admin.esc(c.ac_tag) + '</code></td><td class="num">' + c.in_ac + '</td><td class="num">' + c.added + '</td><td' + (c.error ? ' class="is-error"' : '') + '>' + Admin.esc(c.error || '') + '</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="muted">No cohort with an AC tag in this scope.</p>';
        if (r.missing.length) {
          html += '<h3 class="admin-h3">Enrolled here, but no longer tagged in ActiveCampaign (' + r.missing.length + ')</h3>' +
            '<p class="muted">Possibly refunds or tag changes. Tick the ones to revoke; the others stay as they are.</p>' +
            '<table class="admin-table"><thead><tr><th><input type="checkbox" id="missing-all" aria-label="Select all"></th><th>Student</th><th>Show</th><th>Cohort</th><th>Added by</th></tr></thead><tbody>' +
            r.missing.map(function (m) {
              return '<tr><td><input type="checkbox" data-missing="' + m.enrollment_id + '" aria-label="Revoke ' + Admin.esc(m.email) + '"></td><td>' + Admin.esc(m.name || m.email) + (m.name ? '<div class="muted small">' + Admin.esc(m.email) + '</div>' : '') +
                '</td><td>' + Admin.esc(m.show) + '</td><td>' + Admin.esc(m.cohort) + '</td><td>' + Admin.esc(m.source) + '</td></tr>';
            }).join('') + '</tbody></table><div class="admin-form__actions"><button class="btn-danger" type="button" id="missing-revoke">Revoke selected enrolments</button></div>';
        } else if (r.cohorts.length) {
          html += '<p class="muted">Everyone enrolled here still has their tag in ActiveCampaign.</p>';
        }
        $('sync-report').innerHTML = html;
        return load();
      }).catch(function (err) { Admin.say($('sync-out'), err.message, true); })
        .then(function () { document.querySelectorAll('[data-sync]').forEach(function (x) { x.disabled = false; }); });
    });
  });
  $('sync-report').addEventListener('click', function (ev) {
    if (ev.target.id === 'missing-all') document.querySelectorAll('[data-missing]').forEach(function (c) { c.checked = ev.target.checked; });
    if (ev.target.id === 'missing-revoke') {
      var ids = Array.from(document.querySelectorAll('[data-missing]:checked')).map(function (c) { return c.dataset.missing; });
      if (!ids.length || !confirm('Revoke ' + ids.length + ' enrolment(s)?')) return;
      Admin.post('enrollments-status', { ids: ids, status: 'revoked' }).then(function () {
        ids.forEach(function (id) { var row = document.querySelector('[data-missing="' + id + '"]'); if (row) row.closest('tr').remove(); });
        Admin.say($('sync-out'), ids.length + ' enrolment(s) revoked.');
        return load();
      }).catch(function (err) { Admin.say($('sync-out'), err.message, true); });
    }
  });

  // ---------- import ----------
  var iform = $('import-form'), iout = iform.querySelector('.admin-form__result'), lastCsv = '';
  $('import-open').addEventListener('click', function () { iform.reset(); $('import-preview').innerHTML = ''; $('import-run').hidden = true; Admin.say(iout, ''); show('importer'); });
  iform.file.addEventListener('change', function () {
    var f = iform.file.files[0];
    if (f) f.text().then(function (t) { iform.csv.value = t; });
  });
  iform.addEventListener('submit', function (ev) {
    ev.preventDefault();
    lastCsv = iform.csv.value;
    $('import-run').hidden = true;
    Admin.say(iout, 'Checking…');
    Admin.post('students-import', { csv: lastCsv, dry_run: true }).then(function (r) {
      var s = r.summary;
      Admin.say(iout, s.new + ' new, ' + s.updated + ' existing, ' + s.enrolments + ' enrolments to add, ' + s.errors + ' with errors.' + (s.errors ? ' Fix the errors and preview again.' : ''), s.errors > 0);
      $('import-run').hidden = s.errors > 0 || !(s.new + s.updated);
      $('import-preview').innerHTML = '<table class="admin-table"><thead><tr><th>Line</th><th>Email</th><th>Name</th><th>Cohort</th><th>Result</th></tr></thead><tbody>' +
        r.rows.map(function (x) {
          return '<tr><td class="num">' + x.line + '</td><td>' + Admin.esc(x.email) + '</td><td>' + Admin.esc(x.name || '') + '</td><td>' + Admin.esc(x.cohort || '') + '</td><td' + (/^error/.test(x.result) ? ' class="is-error"' : '') + '>' + Admin.esc(x.result) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (err) { Admin.say(iout, err.message, true); });
  });
  $('import-run').addEventListener('click', function () {
    var btn = this; btn.disabled = true;
    Admin.post('students-import', { csv: lastCsv }).then(function (r) {
      Admin.say(iout, 'Imported: ' + r.summary.new + ' new students, ' + r.summary.enrolments + ' enrolments added.');
      btn.hidden = true;
      return load();
    }).catch(function (err) { Admin.say(iout, err.message, true); }).then(function () { btn.disabled = false; });
  });

  // ---------- export ----------
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  $('export').addEventListener('click', function () {
    var rows = filtered();
    var head = ['email', 'name', 'enrolments', 'access', 'subscribed_at', 'released', 'downloaded', 'apps', 'listen_until', 'personal_page'];
    var lines = [head.join(',')].concat(rows.map(function (s) {
      return [s.email, s.name, s.enrollments.map(function (e) { return e.show.slug + ':' + e.cohort.name + (e.state !== 'active' ? ' (' + STATE_TEXT[e.state] + ')' : ''); }).join(' | '),
        STATE_TEXT[s.state], s.first_seen_at ? Admin.kstParts(s.first_seen_at).date : '', s.released, s.downloaded, s.apps.join(' '),
        s.expires_at ? Admin.kstParts(new Date(new Date(s.expires_at).getTime() - 1)).date : '', s.page_url].map(csvCell).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'podcast-students-' + Admin.kstParts(new Date()).date + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  load();
})();
