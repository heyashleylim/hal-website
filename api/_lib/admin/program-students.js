/*
 * Students admin API (/admin/students): each program student's own words (sales call, onboarding questionnaire,
 * testimonials) with their saved English translation, the analyses of them, and the snippets used for content.
 * (Not the Learning section's students: those are /admin/podcast/students, actions student-* / students-*.)
 *
 * The texts and snippets are never changed here: the database refuses it (migration 014). The admin decides the
 * persona and the rating of each student, links them to their ActiveCampaign contact, and marks snippets.
 *   program-students-overview   numbers, personas, what waits for a decision
 *   program-students            the list, with each analysis round's persona and rating
 *   program-student             one student: texts (Korean + English), analyses, snippets, contact, other enrolments
 *   program-student-save        decision (persona, rating), permission, note, contact link, same person as
 *   program-snippets            the content library (snippets of every student, filterable)
 *   program-snippet-add         a new snippet: a passage selected in a Korean text (found again on the server)
 *   program-snippet-save        star / hide / sensitive / use / note of a snippet (never its words)
 *   program-reference           the analysis sheets (personas, methodology…), Korean cells with their English
 */
const db = require('../db.js');
const { userError, text, int } = require('./util.js');

const PERSONAS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const KINDS = ['sales_call_form', 'sales_call', 'onboarding', 'testimonial', 'video_testimonial'];
const PERMISSIONS = ['unknown', 'ask', 'yes', 'no'];
const id = (v, label = 'id') => int(v, { min: 1, max: 2147483647, label });
const program = (v) => text(v || 'nsmb', { max: 40, label: 'program' }).toLowerCase();

// Each student with the persona and rating every analysis round gave, and whether the rounds agree.
const LIST = `
  SELECT p.id, p.program, p.cohort, p.sheet_row, p.name, p.name_en, p.occupation, p.occupation_en, p.age, p.persona, p.persona_alt,
         p.rating, p.permission, p.contact_id, p.same_as, p.note,
         coalesce((SELECT json_agg(json_build_object('round', a.round, 'persona', a.persona, 'alt', a.persona_alt, 'confidence', a.confidence,
                                                     'rating', a.rating) ORDER BY a.created_at, a.id) FROM student_analyses a WHERE a.student_id = p.id), '[]') AS rounds,
         (SELECT array_agg(t.kind ORDER BY t.kind) FROM student_texts t WHERE t.student_id = p.id AND t.superseded_by IS NULL) AS kinds,
         (SELECT count(*)::int FROM student_texts t WHERE t.student_id = p.id AND t.superseded_by IS NULL AND t.translated_of IS DISTINCT FROM md5(t.text_ko)) AS untranslated
    FROM program_students p`;

// "decide": the rounds disagree (persona, or rating when there is a testimonial) and the admin hasn't decided yet.
function needsDecision(s) {
  const personas = new Set(s.rounds.map((r) => r.persona).filter(Boolean));
  const ratings = new Set(s.rounds.map((r) => r.rating ?? null));
  const hasTestimonial = (s.kinds || []).some((k) => k === 'testimonial' || k === 'video_testimonial');
  return { persona: !s.persona && personas.size > 1, rating: hasTestimonial && s.rating == null && ratings.size > 1 };
}

// Persona names from the program's persona sheet (rows persona_id / persona_name_en / persona_name_ko), e.g.
// { P1: { en: 'The Threshold Dreamer…', ko: '문턱에서 멈춘 실행가' } }. Kept in the database, not in the public site files.
async function personaLabels(prog) {
  const sheet = await db.one(`SELECT rows FROM student_reference WHERE program = $1 AND key = 'personas'`, [prog]);
  const out = {};
  if (!sheet) return out;
  const find = (label) => sheet.rows.find((r) => r[0] && r[0].ko === label);
  const ids = find('persona_id'), en = find('persona_name_en'), ko = find('persona_name_ko');
  if (!ids) return out;
  ids.slice(1).forEach((c, i) => {
    if (!c.ko) return;
    out[c.ko] = { en: en && en[i + 1] ? en[i + 1].ko : '', ko: ko && ko[i + 1] ? ko[i + 1].ko : '' };
  });
  return out;
}

const actions = {
  async 'program-students-overview'(input) {
    const prog = program(input.program);
    const rows = await db.query(`${LIST} WHERE p.program = $1 ORDER BY p.cohort, p.sheet_row`, [prog]);
    const personas = {};
    let decide = 0, testimonials = 0, untranslated = 0;
    for (const s of rows) {
      const k = s.persona || 'undecided';
      personas[k] = (personas[k] || 0) + 1;
      const d = needsDecision(s);
      if (d.persona || d.rating) decide++;
      if ((s.kinds || []).some((x) => x === 'testimonial' || x === 'video_testimonial')) testimonials++;
      untranslated += s.untranslated;
    }
    const [snips, refs, ratings, permission] = await Promise.all([
      db.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE sn.starred)::int AS starred, count(*) FILTER (WHERE sn.sensitive)::int AS sensitive,
                     count(*) FILTER (WHERE sn.quote_en = '')::int AS untranslated
                FROM student_snippets sn JOIN student_texts t ON t.id = sn.text_id JOIN program_students p ON p.id = t.student_id WHERE p.program = $1`, [prog]),
      db.query(`SELECT key, title FROM student_reference WHERE program = $1 ORDER BY position, id`, [prog]),
      db.query(`SELECT rating, count(*)::int AS n FROM program_students WHERE program = $1 AND rating IS NOT NULL GROUP BY rating ORDER BY rating DESC`, [prog]),
      db.query(`SELECT permission, count(*)::int AS n FROM program_students WHERE program = $1 GROUP BY permission`, [prog]),
    ]);
    const programs = await db.query(`SELECT program, count(*)::int AS n FROM program_students GROUP BY program ORDER BY program`);
    return { program: prog, labels: await personaLabels(prog), programs, total: rows.length, testimonials, decide, untranslated, personas, ratings, permission, snippets: snips, reference: refs };
  },

  async 'program-students'(input) {
    const prog = program(input.program);
    const rows = await db.query(`${LIST} WHERE p.program = $1 ORDER BY p.cohort, p.sheet_row`, [prog]);
    for (const s of rows) s.decide = needsDecision(s);
    return { students: rows, labels: await personaLabels(prog) };
  },

  async 'program-student'(input) {
    const sid = id(input.id);
    const s = await db.one(`${LIST} WHERE p.id = $1`, [sid]);
    if (!s) throw userError('student not found', 404);
    s.decide = needsDecision(s);
    const [texts, analyses, snippets, contact, others] = await Promise.all([
      db.query(`SELECT id, kind, text_ko, text_en, source, (translated_of IS NOT DISTINCT FROM md5(text_ko)) AS translated, created_at
                  FROM student_texts WHERE student_id = $1 AND superseded_by IS NULL ORDER BY array_position($2::text[], kind)`, [sid, KINDS]),
      db.query(`SELECT * FROM student_analyses WHERE student_id = $1 ORDER BY created_at, id`, [sid]),
      db.query(`SELECT sn.id, sn.text_id, sn.start, sn.quote, sn.quote_en, sn.use_for, sn.origin, sn.starred, sn.sensitive, sn.hidden, sn.note, t.kind
                  FROM student_snippets sn JOIN student_texts t ON t.id = sn.text_id WHERE t.student_id = $1 ORDER BY sn.starred DESC, t.kind, sn.start`, [sid]),
      s.contact_id ? db.one(`SELECT id, ac_id, email, first_name, last_name, phone, tags, gone_from_ac_at FROM contacts WHERE id = $1`, [s.contact_id]) : null,
      db.query(`SELECT id, program, cohort, sheet_row, name FROM program_students
                 WHERE id <> $1 AND (id = $2 OR same_as = $1 OR (same_as IS NOT NULL AND same_as = $2) OR (contact_id IS NOT NULL AND contact_id = $3))
                 ORDER BY cohort`, [sid, s.same_as, s.contact_id]),
    ]);
    // Contacts that may be this student: same first name (the team keeps the full Korean name there), program tags first.
    const suggestions = s.contact_id ? [] : await db.query(
      `SELECT id, email, first_name, last_name, tags, gone_from_ac_at FROM contacts
        WHERE replace(first_name, ' ', '') = replace($1, ' ', '') OR replace(last_name || first_name, ' ', '') = replace($1, ' ', '')
        ORDER BY EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE '%' || $2 || '%') DESC, ac_created_at LIMIT 10`,
      [s.name.replace(/\(.*\)/, '').trim(), s.program]);
    return { student: s, texts, analyses, snippets, contact, others, suggestions, labels: await personaLabels(s.program) };
  },

  async 'program-student-save'(input) {
    const sid = id(input.id);
    const cur = await db.one(`SELECT id, name, cohort FROM program_students WHERE id = $1`, [sid]);
    if (!cur) throw userError('student not found', 404);
    const sets = [], params = [sid], log = {};
    const set = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); log[col] = value; };
    if ('persona' in input) {
      const v = input.persona || null;
      if (v && !PERSONAS.includes(v)) throw userError('unknown persona');
      set('persona', v);
    }
    if ('persona_alt' in input) {
      const v = input.persona_alt || null;
      if (v && !PERSONAS.includes(v)) throw userError('unknown alternate persona');
      set('persona_alt', v);
    }
    if ('rating' in input) set('rating', input.rating === '' || input.rating == null ? null : int(input.rating, { min: 1, max: 5, label: 'rating' }));
    if ('decided_note' in input) set('decided_note', text(input.decided_note, { max: 2000, label: 'decision note' }));
    if ('permission' in input) {
      if (!PERMISSIONS.includes(input.permission)) throw userError('unknown permission value');
      set('permission', input.permission);
    }
    if ('note' in input) set('note', text(input.note, { max: 5000, label: 'note' }));
    if ('contact_id' in input) {
      const cid = input.contact_id ? id(input.contact_id, 'contact') : null;
      if (cid && !(await db.one(`SELECT 1 AS ok FROM contacts WHERE id = $1`, [cid]))) throw userError('contact not found', 404);
      set('contact_id', cid);
    }
    if ('same_as' in input) {
      const other = input.same_as ? id(input.same_as, 'same as') : null;
      if (other === sid) throw userError('a student can\'t be the same person as herself');
      if (other && !(await db.one(`SELECT 1 AS ok FROM program_students WHERE id = $1`, [other]))) throw userError('student not found', 404);
      set('same_as', other);
    }
    if (!sets.length) throw userError('nothing to change');
    const row = await db.one(`UPDATE program_students SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, params);
    return { student: row, target: `${cur.name} (cohort ${cur.cohort})`, log };
  },

  async 'program-snippets'(input) {
    const prog = program(input.program);
    const where = ['p.program = $1'], params = [prog];
    const add = (cond, value) => { params.push(value); where.push(cond.replace('?', `$${params.length}`)); };
    if (input.persona) add('p.persona = ?', String(input.persona));
    if (input.min_rating) add('p.rating >= ?', int(input.min_rating, { min: 1, max: 5, label: 'rating' }));
    if (input.kind) {
      if (input.kind === 'testimonials') where.push(`t.kind IN ('testimonial', 'video_testimonial')`);
      else if (input.kind === 'intake') where.push(`t.kind IN ('sales_call_form', 'sales_call', 'onboarding')`);
    }
    if (input.starred === '1') where.push('sn.starred');
    if (input.include_sensitive !== '1') where.push('NOT sn.sensitive');
    if (input.include_hidden !== '1') where.push('NOT sn.hidden');
    if (input.permission === 'usable') where.push(`p.permission <> 'no'`);
    if (input.permission === 'yes') where.push(`p.permission = 'yes'`);
    const q = text(input.q, { max: 100, label: 'search' }).toLowerCase();
    if (q) add(`position(? in lower(sn.quote || ' ' || sn.quote_en || ' ' || sn.use_for || ' ' || sn.note || ' ' || p.name || ' ' || p.name_en)) > 0`, q);
    const rows = await db.query(
      `SELECT sn.id, sn.quote, sn.quote_en, sn.use_for, sn.origin, sn.starred, sn.sensitive, sn.hidden, sn.note, t.kind,
              p.id AS student_id, p.name, p.name_en, p.cohort, p.persona, p.rating, p.permission
         FROM student_snippets sn JOIN student_texts t ON t.id = sn.text_id JOIN program_students p ON p.id = t.student_id
        WHERE ${where.join(' AND ')}
        ORDER BY sn.starred DESC, p.rating DESC NULLS LAST, t.kind = 'testimonial' DESC, p.cohort, sn.id LIMIT 1000`, params);
    return { snippets: rows, labels: await personaLabels(prog) };
  },

  // The browser sends the selected Korean passage; it is looked up in the text (the nth occurrence when it
  // appears several times), so what is saved is always the text's own characters.
  async 'program-snippet-add'(input) {
    const tid = id(input.text_id, 'text');
    const quote = String(input.quote == null ? '' : input.quote);
    if (!quote.trim()) throw userError('select a passage of the Korean text first');
    if (quote.length > 2000) throw userError('the passage is too long for a snippet (2,000 characters at most)');
    const t = await db.one(`SELECT t.id, t.text_ko, p.name, p.cohort FROM student_texts t JOIN program_students p ON p.id = t.student_id WHERE t.id = $1 AND t.superseded_by IS NULL`, [tid]);
    if (!t) throw userError('text not found', 404);
    const nth = input.nth ? int(input.nth, { min: 1, max: 1000, label: 'occurrence' }) : 1;
    // positions in characters (code points), as Postgres counts them
    const chars = [...t.text_ko], want = [...quote];
    let found = 0, start = 0;
    for (let i = 0; i + want.length <= chars.length && !start; i++) {
      if (chars[i] === want[0] && chars.slice(i, i + want.length).join('') === quote && ++found === nth) start = i + 1;
    }
    if (!start) throw userError('this passage is not in the text exactly as selected');
    const row = await db.one(
      `INSERT INTO student_snippets (text_id, start, quote, use_for, origin, note) VALUES ($1, $2, $3, $4, 'admin', $5)
       ON CONFLICT (text_id, start, quote) DO UPDATE SET hidden = false, updated_at = now() RETURNING *`,
      [tid, start, quote, text(input.use_for, { max: 300, label: 'use' }), text(input.note, { max: 2000, label: 'note' })]);
    return { snippet: row, target: `${t.name} (cohort ${t.cohort})`, log: { snippet: row.id, characters: want.length } };
  },

  async 'program-snippet-save'(input) {
    const sid = id(input.id);
    const sets = [], params = [sid];
    const set = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); };
    for (const flag of ['starred', 'sensitive', 'hidden']) if (flag in input) set(flag, Boolean(input[flag]));
    if ('use_for' in input) set('use_for', text(input.use_for, { max: 300, label: 'use' }));
    if ('note' in input) set('note', text(input.note, { max: 2000, label: 'note' }));
    if (!sets.length) throw userError('nothing to change');
    const row = await db.one(`UPDATE student_snippets SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, params);
    if (!row) throw userError('snippet not found', 404);
    const changed = Object.fromEntries(Object.keys(input).filter((k) => k !== 'id').map((k) => [k, input[k]]));
    return { snippet: row, target: `snippet ${sid}`, log: { snippet: sid, ...changed } };
  },

  async 'program-reference'(input) {
    const prog = program(input.program);
    const sheets = await db.query(`SELECT key, title, rows, source, updated_at FROM student_reference WHERE program = $1 ORDER BY position, id`, [prog]);
    return { sheets };
  },
};

module.exports = {
  section: 'students',
  actions,
  writes: ['program-student-save', 'program-snippet-add', 'program-snippet-save'],
  needsDecision,
};
