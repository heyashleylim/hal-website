/*
 * What a buyer types at checkout → clean values, or the list of problems per field (pure: no database).
 * The same rules run in the browser (site/assets/js/checkout.js) for instant feedback; this file is the
 * authority. Problem codes map to Korean messages in copy.ko.js (`errors`).
 */

// ISO 3166-1 alpha-2 codes for the address and phone country lists. Names are produced in Korean by Intl.DisplayNames.
const COUNTRY_CODES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
const COUNTRY_SET = new Set(COUNTRY_CODES);
const COMMON = ['KR', 'US', 'AU', 'CA', 'JP', 'GB', 'NZ', 'SG', 'DE'];

// Country calling codes for the phone field (same countries as above).
const DIAL = {
  AD:'376', AE:'971', AF:'93', AG:'1', AI:'1', AL:'355', AM:'374', AO:'244', AR:'54', AS:'1', AT:'43', AU:'61', AW:'297', AX:'358', AZ:'994', BA:'387',
  BB:'1', BD:'880', BE:'32', BF:'226', BG:'359', BH:'973', BI:'257', BJ:'229', BL:'590', BM:'1', BN:'673', BO:'591', BQ:'599', BR:'55', BS:'1', BT:'975',
  BW:'267', BY:'375', BZ:'501', CA:'1', CC:'61', CD:'243', CF:'236', CG:'242', CH:'41', CI:'225', CK:'682', CL:'56', CM:'237', CN:'86', CO:'57', CR:'506',
  CU:'53', CV:'238', CW:'599', CX:'61', CY:'357', CZ:'420', DE:'49', DJ:'253', DK:'45', DM:'1', DO:'1', DZ:'213', EC:'593', EE:'372', EG:'20', ER:'291',
  ES:'34', ET:'251', FI:'358', FJ:'679', FK:'500', FM:'691', FO:'298', FR:'33', GA:'241', GB:'44', GD:'1', GE:'995', GF:'594', GG:'44', GH:'233', GI:'350',
  GL:'299', GM:'220', GN:'224', GP:'590', GQ:'240', GR:'30', GT:'502', GU:'1', GW:'245', GY:'592', HK:'852', HN:'504', HR:'385', HT:'509', HU:'36', ID:'62',
  IE:'353', IL:'972', IM:'44', IN:'91', IQ:'964', IR:'98', IS:'354', IT:'39', JE:'44', JM:'1', JO:'962', JP:'81', KE:'254', KG:'996', KH:'855', KI:'686',
  KM:'269', KN:'1', KR:'82', KW:'965', KY:'1', KZ:'7', LA:'856', LB:'961', LC:'1', LI:'423', LK:'94', LR:'231', LS:'266', LT:'370', LU:'352', LV:'371',
  LY:'218', MA:'212', MC:'377', MD:'373', ME:'382', MF:'590', MG:'261', MH:'692', MK:'389', ML:'223', MM:'95', MN:'976', MO:'853', MP:'1', MQ:'596', MR:'222',
  MS:'1', MT:'356', MU:'230', MV:'960', MW:'265', MX:'52', MY:'60', MZ:'258', NA:'264', NC:'687', NE:'227', NF:'672', NG:'234', NI:'505', NL:'31', NO:'47',
  NP:'977', NR:'674', NU:'683', NZ:'64', OM:'968', PA:'507', PE:'51', PF:'689', PG:'675', PH:'63', PK:'92', PL:'48', PM:'508', PR:'1', PS:'970', PT:'351',
  PW:'680', PY:'595', QA:'974', RE:'262', RO:'40', RS:'381', RU:'7', RW:'250', SA:'966', SB:'677', SC:'248', SD:'249', SE:'46', SG:'65', SH:'290', SI:'386',
  SK:'421', SL:'232', SM:'378', SN:'221', SO:'252', SR:'597', SS:'211', ST:'239', SV:'503', SX:'1', SY:'963', SZ:'268', TC:'1', TD:'235', TG:'228', TH:'66',
  TJ:'992', TK:'690', TL:'670', TM:'993', TN:'216', TO:'676', TR:'90', TT:'1', TV:'688', TW:'886', TZ:'255', UA:'380', UG:'256', US:'1', UY:'598', UZ:'998',
  VA:'39', VC:'1', VE:'58', VG:'1', VI:'1', VN:'84', VU:'678', WF:'681', WS:'685', YE:'967', YT:'262', ZA:'27', ZM:'260', ZW:'263',
};
// The phone field's country list: Korea (the default) and the countries buyers are in first.
const PHONE_FIRST = ['KR', 'US', 'AU', 'CA', 'JP', 'GB', 'NZ', 'SG', 'DE'];
// Countries where a number keeps its leading 0 after the country code (Italy and its neighbours).
const KEEP_ZERO = new Set(['IT', 'SM', 'VA']);

// [{ code, name, dial }] for the phone country list, Korea first.
function phoneCountries() {
  const names = new Intl.DisplayNames(['ko'], { type: 'region' });
  const all = COUNTRY_CODES.map((code) => ({ code, name: names.of(code) || code, dial: DIAL[code] }));
  const rest = all.filter((c) => !PHONE_FIRST.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return [...PHONE_FIRST.map((code) => all.find((c) => c.code === code)), ...rest];
}

/*
 * A phone number and the country chosen beside it → '+821012345678' style (E.164), or { error }.
 * Korea (the default, also when no country was sent): a Korean mobile number, any common spelling.
 * Elsewhere: the national number; a leading trunk 0 is dropped (Australia 0412… → +61412…).
 * A number typed with its own + or 00 country code wins over the list.
 * The same rules run in site/assets/js/checkout.js.
 */
function phoneInput(countryValue, value) {
  const raw = clean(value);
  if (!raw) return { error: 'phone_required' };
  const country = COUNTRY_SET.has(clean(countryValue).toUpperCase()) ? clean(countryValue).toUpperCase() : 'KR';
  if (/[^\d+\s().-]/.test(raw)) return { error: country === 'KR' ? 'phone_invalid' : 'phone_invalid_intl' };
  if (/^(\+|00)/.test(raw)) {
    const intl = raw.replace(/\D/g, '').replace(/^00/, '');
    if (intl.startsWith('82')) { const kr = koreanMobile('+' + intl); return kr ? { value: '+82' + kr.slice(1) } : { error: 'phone_invalid' }; }
    const full = internationalPhone('+' + intl);
    return full ? { value: full } : { error: 'phone_invalid_intl' };
  }
  if (country === 'KR') { const kr = koreanMobile(raw); return kr ? { value: '+82' + kr.slice(1) } : { error: 'phone_invalid' }; }
  const dial = DIAL[country];
  let national = raw.replace(/\D/g, '');
  if (dial === '1' && national.length === 11 && national.startsWith('1')) national = national.slice(1);
  if (!KEEP_ZERO.has(country) && national.startsWith('0')) national = national.slice(1);
  const ok = dial === '1' ? /^[2-9]\d{9}$/.test(national)
    : country === 'AU' ? /^\d{9}$/.test(national)
      : national.length >= 6 && dial.length + national.length <= 15;
  return ok ? { value: '+' + dial + national } : { error: 'phone_invalid_intl' };
}

// '+821012345678' → '010-1234-5678' for Korean numbers; any other number is shown as stored.
function displayPhone(e164) {
  const v = String(e164 || '');
  const m = /^\+82(1\d)(\d{3,4})(\d{4})$/.exec(v);
  return m ? `0${m[1]}-${m[2]}-${m[3]}` : v;
}

// [{ code, name }] for the address country list: Korea (the default) and the countries buyers are in first, then every country by Korean name.
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
 * checkoutInput(input) → { ok: true, value } or { ok: false, errors: { field: code } }.
 * Phone: a country from the list (Korea by default) and the number → E.164 (phoneInput).
 * Address: its country (Korea by default). In Korea a 5-digit postcode (from the Kakao search); elsewhere a
 * free-form address with an optional postcode. The payment method doesn't change these rules.
 */
function checkoutInput(input) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};

  const name = clean(src.name);
  if (!name) errors.name = 'name_required';
  else if (name.length > 60) errors.name = 'name_long';

  const email = clean(src.email).toLowerCase();
  if (!email) errors.email = 'email_required';
  else if (!validEmail(email)) errors.email = 'email_invalid';

  const phoneCheck = phoneInput(src.phone_cc, src.phone);
  const phone = phoneCheck.value || null;
  if (phoneCheck.error) errors.phone = phoneCheck.error;

  const address1 = clean(src.address1);
  const address2 = clean(src.address2);
  const postcode = clean(src.postcode);
  let country = 'KR';
  if (!address1) errors.address1 = 'address1_required';
  else if (address1.length > 200) errors.address1 = 'address1_long';
  if (address2.length > 100) errors.address2 = 'address2_long';

  // The address's country, whatever the payment method (a buyer in Korea may pay with PayPal, one abroad by card).
  // A form without the field (an old page) is a Korean address, as before.
  country = src.country == null ? 'KR' : clean(src.country).toUpperCase();
  if (!COUNTRY_SET.has(country)) errors.country = 'country_required';
  else if (country === 'KR') {
    if (!postcode) errors.postcode = 'postcode_required';
    else if (!/^\d{5}$/.test(postcode)) errors.postcode = 'postcode_invalid';
  } else if (postcode.length > 20) errors.postcode = 'postcode_long';

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

module.exports = { checkoutInput, sourceInput, koreanMobile, internationalPhone, phoneInput, phoneCountries, displayPhone, DIAL, validEmail, clean, countries, COUNTRY_SET, SOURCE_KEYS };
