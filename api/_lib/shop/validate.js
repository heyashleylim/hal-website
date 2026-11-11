/*
 * What a buyer types at checkout → clean values, or the list of problems per field (pure: no database).
 * The same rules run in the browser (site/assets/js/checkout.js) for instant feedback; this file is the
 * authority. Problem codes map to Korean messages in copy.ko.js (`errors`).
 */

// ISO 3166-1 alpha-2 codes offered to USD buyers. Names are produced in Korean by Intl.DisplayNames.
const COUNTRY_CODES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
const COUNTRY_SET = new Set(COUNTRY_CODES);
const COMMON = ['US', 'CA', 'AU', 'GB', 'JP', 'SG', 'DE', 'NZ'];

// [{ code, name }] for the country list: the countries most buyers are in first, then every country by Korean name.
function countries() {
  const names = new Intl.DisplayNames(['ko'], { type: 'region' });
  const all = COUNTRY_CODES.map((code) => ({ code, name: names.of(code) || code }));
  const rest = all.filter((c) => !COMMON.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return [...COMMON.map((code) => all.find((c) => c.code === code)), ...rest];
}

// Trims, drops control characters and collapses runs of spaces.
function clean(value) {
  // eslint-disable-next-line no-control-regex
  return String(value == null ? '' : value).normalize('NFC').replace(/[\u0000-\u001F\u007F​-‍﻿]/g, ' ').replace(/\s+/g, ' ').trim();
}

// A Korean mobile number in any common spelling → '01012345678', or null.
function koreanMobile(value) {
  let d = String(value == null ? '' : value).replace(/[^\d+]/g, '');
  if (d.startsWith('+82')) d = '0' + d.slice(3);
  else if (d.startsWith('0082')) d = '0' + d.slice(4);
  else if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2);
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(1); // "+82 010…" typed with the leading zero kept
  // 010 numbers always have 11 digits; the older prefixes (011, 016…) have 10 or 11.
  return /^(010\d{8}|01[16789]\d{7,8})$/.test(d) ? d : null;
}

// Any phone number with a country code → '+14155550123' style, or null.
function internationalPhone(value) {
  const raw = String(value == null ? '' : value).trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (/[^\d+\s().-]/.test(raw)) return null;
  return '+' + digits.replace(/^00/, '');
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@"'<>()\\,;:]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value) && !/\.\./.test(value);
}

/*
 * checkoutInput(input, 'KRW' | 'USD') → { ok: true, value } or { ok: false, errors: { field: code } }.
 * KRW buyers are in Korea: Korean mobile number, 5-digit postcode, address from the Kakao search.
 * USD buyers are abroad: country, free-form address, phone with country code.
 */
function checkoutInput(input, currency) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};

  const name = clean(src.name);
  if (!name) errors.name = 'name_required';
  else if (name.length > 60) errors.name = 'name_long';

  const email = clean(src.email).toLowerCase();
  if (!email) errors.email = 'email_required';
  else if (!validEmail(email)) errors.email = 'email_invalid';

  let phone = null;
  if (!clean(src.phone)) errors.phone = 'phone_required';
  else if (currency === 'USD') {
    phone = koreanMobile(src.phone) || internationalPhone(src.phone);
    if (!phone) errors.phone = 'phone_invalid_intl';
  } else {
    phone = koreanMobile(src.phone);
    if (!phone) errors.phone = 'phone_invalid';
  }

  const address1 = clean(src.address1);
  const address2 = clean(src.address2);
  const postcode = clean(src.postcode);
  let country = 'KR';
  if (!address1) errors.address1 = 'address1_required';
  else if (address1.length > 200) errors.address1 = 'address1_long';
  if (address2.length > 100) errors.address2 = 'address2_long';

  if (currency === 'USD') {
    country = clean(src.country).toUpperCase();
    if (!COUNTRY_SET.has(country)) errors.country = 'country_required';
    if (postcode.length > 20) errors.postcode = 'postcode_long';
  } else if (!postcode) errors.postcode = 'postcode_required';
  else if (!/^\d{5}$/.test(postcode)) errors.postcode = 'postcode_invalid';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, phone, country, postcode, address1, address2 } };
}

// Campaign values captured when the checkout opens (utm_*, click ids): short, plain strings only.
const SOURCE_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ref'];
function sourceInput(input) {
  const out = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const key of SOURCE_KEYS) {
    const v = clean(src[key]).slice(0, 200);
    if (v) out[key] = v;
  }
  return out;
}

module.exports = { checkoutInput, sourceInput, koreanMobile, internationalPhone, validEmail, clean, countries, COUNTRY_SET, SOURCE_KEYS };
