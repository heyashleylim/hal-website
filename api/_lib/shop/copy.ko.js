/*
 * Every Korean string a customer sees on the checkout and thank-you pages, in one place.
 * Register: 해요체, like the podcast pages (ashley-lim-voice: warm, never blaming, no emoji in forms).
 * Ashley's own lines (consent, guarantee, secure-payment note, PayPal instalments note, thank-you text) come
 * from the admin (Shop → Settings, and each product); the defaults here are only used while those are empty.
 */
const SUPPORT_EMAIL = 'hello@ashleylim.com';

const copy = {
  supportEmail: SUPPORT_EMAIL,
  skip: '본문으로 건너뛰기',
  secure: '안전 결제',
  title: '결제하기',

  summary: {
    title: '주문 요약',
    included: '포함 내용',
    price: '금액',
    total: '총 결제 금액',
    vat: (amount) => `부가세 ${amount} 포함`,
    show: '주문 내용 보기',
  },

  sections: { me: '내 정보', address: '주소', method: '결제 방법' },

  fields: {
    name: '이름',
    email: '이메일',
    emailHint: '주문과 수업 안내를 받을 주소예요.',
    phone: '휴대폰 번호',
    phoneCountry: '국가 번호',
    postcode: '우편번호',
    address1: '주소',
    address2: '상세 주소',
    address2Hint: '동·호수 등 (선택)',
    country: '국가',
    postcodeOptional: '우편번호 (선택)',
    search: '주소 검색',
    searchAgain: '주소 다시 검색',
    searchClose: '검색 닫기',
    searchTitle: '주소 검색',
    searchFailed: '주소 검색을 불러오지 못했어요. 주소를 직접 입력해 주세요.',
    chooseCountry: '국가를 선택해 주세요',
  },

  methods: {
    card: '신용/체크카드',
    cardFull: '일시불',
    paypal: 'PayPal',
    paypalNote: 'PayPal 계정 또는 해외 카드로 결제해요.',
    toUsd: '해외에서 결제하시나요? PayPal로 결제하기 (USD)',
    toKrw: '한국 카드로 결제하기 (KRW)',
    redirectCard: '다음 화면에서 카드 정보를 입력해요.',
    redirectPaypal: '다음 화면에서 PayPal로 이동해요.',
  },

  // Default consent line: the wording already published on the WooCommerce checkout (2026-11-10).
  consent: '구매를 진행하면 <a href="/terms-and-conditions" target="_blank" rel="noopener">이용 약관</a> 및 <a href="/privacy-policy" target="_blank" rel="noopener">개인정보 보호정책</a>에 동의하는 것입니다',

  // docs/DESIGN.md: a primary button's label ends in an arrow.
  pay: (amount) => `${amount} 결제하기 →`,
  side: { included: '포함 내용', reviews: '후기' },

  // Add-ons offered on the checkout (Marie Forleo's "Popular add-ons" manner). The names, prices and texts of
  // each add-on come from its product in the admin.
  addons: {
    title: '추가 상품',
    add: '추가',
    added: '추가됨',
    addLabel: (name) => `${name} 주문에 추가`,
    more: '자세히 보기',
    remove: '빼기',
    removeLabel: (name) => `${name} 주문에서 빼기`,
    regular: '정가',
    price: '판매가',
  },
  paying: '결제 화면으로 이동하고 있어요…',

  // Field problems. Keys are the codes api/_lib/shop/validate.js returns.
  errors: {
    name_required: '이름을 입력해 주세요.',
    name_long: '이름이 너무 길어요. 60자 이내로 입력해 주세요.',
    email_required: '이메일을 입력해 주세요.',
    email_invalid: '이메일 주소를 다시 확인해 주세요.',
    phone_required: '휴대폰 번호를 입력해 주세요.',
    phone_invalid: '휴대폰 번호를 다시 확인해 주세요. (예: 010-1234-5678)',
    phone_invalid_intl: '전화번호를 다시 확인해 주세요. 왼쪽에서 국가를 고른 뒤 번호를 입력해 주세요.',
    postcode_required: '주소 검색으로 우편번호를 입력해 주세요.',
    postcode_invalid: '우편번호는 숫자 5자리예요.',
    postcode_long: '우편번호가 너무 길어요.',
    address1_required: '주소를 입력해 주세요.',
    address1_long: '주소가 너무 길어요.',
    address2_long: '상세 주소가 너무 길어요.',
    country_required: '국가를 선택해 주세요.',
  },
  emailTypo: (suggestion) => `혹시 ${suggestion} 아닌가요?`,
  emailTypoUse: '이 주소로 바꾸기',

  // Problems with the order as a whole. Keys are the codes the order API returns.
  problems: {
    invalid: '입력하신 내용을 다시 확인해 주세요.',
    closed: '지금은 신청 기간이 아니에요.',
    unavailable: '이 결제 방법은 지금 사용할 수 없어요. 다른 방법을 선택해 주세요.',
    addon_unavailable: '선택하신 추가 상품은 지금 함께 구매할 수 없어요. 주문 내용을 확인하고 다시 시도해 주세요.',
    too_many: '짧은 시간에 요청이 너무 많았어요. 잠시 후 다시 시도해 주세요.',
    provider: '결제 화면을 여는 중에 문제가 생겼어요. 잠시 후 다시 시도해 주세요. 계속되면 ' + SUPPORT_EMAIL + '으로 알려 주세요.',
    not_configured: '지금은 결제를 진행할 수 없어요. ' + SUPPORT_EMAIL + '으로 알려 주시면 바로 도와드릴게요.',
    cancelled: '결제가 완료되지 않았어요. 아래에서 다시 진행하실 수 있어요.',
    declined: '결제가 승인되지 않았어요. 다른 결제 수단으로 다시 시도해 주세요.',
    network: '연결이 불안정해요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
    server: '일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  },

  closed: {
    title: '지금은 신청 기간이 아니에요',
    notStarted: '아직 신청이 시작되지 않았어요.',
    ended: '이번 신청은 마감되었어요.',
    closed: '지금은 신청을 받고 있지 않아요.',
    back: '프로그램 살펴보기',
    contact: `궁금한 점은 ${SUPPORT_EMAIL}으로 알려 주세요.`,
  },

  notFound: {
    title: '페이지를 찾을 수 없어요',
    body: '주소가 바뀌었거나 잘못 입력되었을 수 있어요.',
    home: '홈으로 가기',
  },

  complete: {
    paidTitle: '결제가 완료되었어요',
    paidLead: (name) => `${name}님, 감사합니다.`,
    order: '주문 번호',
    product: '프로그램',
    addon: '추가 상품',
    amount: '결제 금액',
    date: '결제일',
    receipt: '영수증 보기',
    thanksDefault: '함께하게 되어 기뻐요.',
    contact: `궁금한 점은 ${SUPPORT_EMAIL}으로 알려 주세요.`,

    pendingTitle: '결제를 확인하고 있어요',
    pendingLead: '잠시만 기다려 주세요. 보통 몇 초 안에 끝나요.',
    pendingKeep: '이 화면을 닫지 말아 주세요.',
    slowTitle: '아직 결제가 확인되지 않았어요',
    slowLead: `결제를 마치셨다면 조금 뒤에 확인될 수 있어요. 몇 분이 지나도 그대로라면 ${SUPPORT_EMAIL}으로 알려 주세요. 주문 번호를 함께 알려 주시면 더 빨리 도와드릴 수 있어요.`,
    retry: '결제를 마치지 않으셨다면 다시 결제하기',
    refresh: '다시 확인하기',

    endedTitle: '결제가 완료되지 않았어요',
    endedLead: '주문이 취소되었거나 시간이 지나 만료되었어요. 다시 진행하실 수 있어요.',
    again: '다시 결제하기',

    refundedTitle: '환불된 주문이에요',
    refundedLead: `환불에 대해 궁금한 점은 ${SUPPORT_EMAIL}으로 알려 주세요.`,

    missingTitle: '주문 정보를 찾을 수 없어요',
    missingLead: `결제를 마치셨다면 걱정하지 마세요. 결제 내역은 안전하게 기록되어 있어요. 확인이 필요하면 ${SUPPORT_EMAIL}으로 알려 주세요.`,
  },

  error: {
    title: '잠시 후 다시 시도해 주세요',
    body: '일시적인 문제로 페이지를 불러오지 못했어요.',
  },
};

module.exports = copy;
