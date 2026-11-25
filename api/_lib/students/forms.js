/*
 * Review forms of the Students section: their questions (Korean as asked, with the hint under each when there is one,
 * and English for the admin), the CSV columns of the old form's export, and the copy of its page. Used by the review
 * form pages (written by tools/students/review-page.js; tests/students/reviews.test.js checks they match), the endpoint
 * that saves them (api/review.js), the CSV import in the admin, and the admin pages.
 * A new review form = a new entry here, then `node tools/students/review-page.js <form key>`.
 *
 * cohort: a number, or 'tags' = read from her ActiveCampaign purchase tag (purchased_<program>_<cohort>_…, the
 * highest one), for programs whose form serves every cohort (NSMB).
 */
const FORMS = {
  'lifeartist-2026': {
    program: 'lifeartist',
    cohort: 1,
    title: 'Life Artist 2026 review',
    title_ko: '라이프 아티스트 2026 후기',
    page: {
      path: 'lifeartist/review',
      heading: '라이프 아티스트 여정, 어떠셨나요?',
      intro: ['12주 동안 경험한 변화와 마음을 편하게 들려주세요.'],
      email_hint: '라이프 아티스트를 신청하실 때 사용한 이메일을 적어 주세요.',
      description: '라이프 아티스트 2026 후기를 들려주세요.',
    },
    questions: [
      {
        key: 'why_continue', csv: 'review_why_continue_after_nsmb', required: true, short: 'Why she continued after NSMB',
        ko: '내성만방 이후, 라이프 아티스트로 계속 이어가기로 결정하게 된 이유는 무엇이었나요?',
        hint: '그때의 나는 어떤 상태였는지, 무엇을 더 깊이 다루고 싶었는지, 혹은 어떤 변화와 확장을 기대했는지 자유롭게 적어주세요. 일, 관계, 감정, 건강, 돈, 자기확신 등 어떤 영역이든 괜찮아요.',
        en: 'After NSMB, what made you decide to continue with Life Artist?',
      },
      {
        key: 'moment_changing', csv: 'review_moment_changing', required: true, short: 'The moment she felt she was changing',
        ko: '라이프 아티스트를 하면서 “아, 내가 달라지고 있구나”라고 느꼈던 순간이 있었나요?',
        hint: '특정한 선택, 대화, 감정 반응, 행동, 관계의 변화, 혹은 스스로를 바라보는 방식의 변화 등 구체적인 장면이 있다면 나눠주세요.',
        en: 'During Life Artist, was there a moment when you felt “I’m changing”?',
      },
      {
        key: 'how_different', csv: 'review-how-different-now', required: true, short: 'What changed most',
        ko: '지금의 나는, 라이프 아티스트를 시작하기 전의 나와 비교해 무엇이 가장 달라졌나요?',
        hint: '내면의 변화도 좋고, 실제 삶에서 달라진 결과도 좋아요. 생각하는 방식, 감정을 다루는 방식, 선택하는 방식, 관계 맺는 방식, 삶을 창조하는 태도 등 자유롭게 적어주세요.',
        en: 'Compared with who you were before Life Artist, what has changed most?',
      },
      {
        key: 'what_new', csv: 'review-what-new', required: true, short: 'What opened up or expanded',
        ko: '라이프 아티스트를 통해 새롭게 열리거나 가장 크게 확장된 영역은 무엇인가요?',
        hint: '예를 들어 자기표현, 창조성, 관계, 리더십, 돈, 일, 몸, 감정, 자기확신, 삶의 방향성 등 그 영역에서 어떤 변화가 있었는지 구체적으로 적어주세요.',
        en: 'Which area of your life opened up or expanded most through Life Artist?',
      },
      {
        key: 'best_part', csv: 'review_life_artist_best_part', required: true, short: 'The best part',
        ko: '라이프 아티스트에서 특히 가장 좋았던 점, 혹은 가장 크게 도움이 되었던 부분은 무엇이었나요?',
        hint: '콘텐츠, 진행 방식, 과제, 텔레그램, 분위기, 애슐리의 코칭, 함께한 사람들, 커뮤니티의 에너지 등 무엇이든 괜찮아요.',
        en: 'What did you like most about Life Artist, or what helped you most?',
      },
      {
        key: 'recommend', csv: 'review_recommend_to_friend', required: true, short: 'Why she would recommend it',
        ko: '내성만방 이후 라이프 아티스트를 고민하고 있는 친구에게 이 프로그램을 추천한다면, 어떤 이유로 추천하고 싶나요?',
        hint: '왜 이 여정을 추천하고 싶은지, 나에게는 어떤 점에서 가치 있었는지 자유롭게 적어주세요.',
        en: 'If a friend who finished NSMB were considering Life Artist, why would you recommend it?',
      },
      {
        key: 'improve', csv: 'review_advice_better_la', required: true, short: 'What could be better',
        ko: '더 좋아질 수 있는 점이 있다면 무엇일까요?',
        hint: '아쉬웠던 점, 더 보완되면 좋겠는 부분, 추가되면 좋을 요소가 있다면 편하게 적어주세요.',
        en: 'What could be better?',
      },
      {
        key: 'message_to_self', csv: 'review_message_to_self', required: true, short: 'A word to her past self',
        ko: '라이프 아티스트를 시작하기 전의 나에게 지금의 내가 한마디 해줄 수 있다면, 뭐라고 말해주고 싶나요?',
        hint: '그때의 나에게 꼭 전해주고 싶은 말, 안심시켜주고 싶은 말, 혹은 지금의 내가 알게 된 것을 자유롭게 적어주세요.',
        en: 'If you could say one thing to yourself before Life Artist, what would it be?',
      },
      {
        key: 'final_thoughts', csv: 'review-final-thoughts', required: false, short: 'Last words',
        ko: '💌 마지막으로 남기고 싶은 말이 있다면?',
        hint: '내성만방 후 다시 함께한 소감, 아직 나누지 못한 감정이나 배움, 혹은 애슐리에게 전하고 싶은 말 — 무엇이든 자유롭게 적어주세요 :)',
        en: 'Anything else you’d like to say?',
      },
    ],
    csv: { name: 'Name', email: 'Email Address', submitted_at: 'created_at' },
  },
  // The questions of the NSMB review form as cohort 10 answered them (in their testimonials, with the export's
  // column names), Alex 2026-11-25. No hints were found: add them here when Ashley has them.
  'nsmb': {
    program: 'nsmb',
    cohort: 'tags',
    title: 'NSMB review',
    title_ko: '내성만방 후기',
    page: {
      path: 'nsmb/review',
      heading: '내성만방 여정, 어떠셨나요?',
      intro: ['12주 동안 경험한 변화와 마음을 편하게 들려주세요.'],
      email_hint: '내성만방을 신청하실 때 사용한 이메일을 적어 주세요.',
      description: '내성만방 후기를 들려주세요.',
    },
    questions: [
      { key: 'life_before', csv: 'review-life-before-nsmb', required: true, short: 'Her life 12 weeks before',
        ko: '12주 전으로 돌아가 보세요. 그때의 일상은 어떤 모습이었나요?', en: 'Go back 12 weeks. What did your everyday life look like then?' },
      { key: 'hesitation', csv: 'review-hesitation-before-purchase', required: true, short: 'What made her hesitate, and what decided her',
        ko: '내성만방을 신청하기 전, 가장 망설였던 이유는 무엇이었나요? 그리고 그 망설임을 넘어서게 만든 결정적인 계기는요?',
        en: 'Before signing up for NSMB, what made you hesitate most? And what finally got you past it?' },
      { key: 'how_different', csv: 'review-how-different-now', required: true, short: 'What changed most',
        ko: '지금의 나는, 12주 전의 나와 비교해 무엇이 가장 달라졌나요?', en: 'Compared with yourself 12 weeks ago, what has changed most?' },
      { key: 'recommend', csv: 'review-recommend-friend', required: true, short: 'Her message to someone hesitating',
        ko: '그때의 나처럼 내성만방을 망설이고 있는 사람에게, 꼭 전하고 싶은 말이 있다면 자유롭게 적어주세요.',
        en: 'If someone is hesitating about NSMB the way you once did, what would you most like to tell them?' },
      { key: 'worth_it', csv: 'review-nsmb-worth-it', required: true, short: 'Was it worth the time, energy and money',
        ko: '내성만방은 시간, 에너지, 비용을 들일 만큼 가치 있는 여정이었나요?', en: 'Was NSMB a journey worth the time, energy and money you put in?' },
      { key: 'best_part', csv: 'review_best_about_nsmb', required: true, short: 'The best part',
        ko: '내성만방에서 특히 가장 좋았던 점, 혹은 가장 크게 도움이 되었던 부분은 무엇이었나요?', en: 'What did you like most about NSMB, or what helped you most?' },
      { key: 'improve', csv: 'review_advice_better_nsmb', required: true, short: 'What could be better',
        ko: '더 좋아질 수 있는 점이 있다면 무엇일까요?', en: 'What could be better?' },
      { key: 'final_thoughts', csv: 'review-final-thoughts', required: false, short: 'Last words',
        ko: '💌 마지막으로 남기고 싶은 말이 있다면?', en: 'Anything else you’d like to say?' },
    ],
    csv: { name: 'Name', email: 'Email Address', submitted_at: 'created_at' },
  },
};

const MAX_ANSWER = 10000;

function form(key) {
  const f = FORMS[key];
  if (!f) { const err = new Error('unknown review form'); err.status = 400; err.expose = true; throw err; }
  return f;
}

// Every form's questions by "<program>:<question_key>", for the admin (labels of review answers).
function questionLabels() {
  const out = {};
  for (const [key, f] of Object.entries(FORMS)) {
    f.questions.forEach((q, i) => { out[`${f.program}:${q.key}`] = { form: key, n: i + 1, ko: q.ko, en: q.en, short: q.short }; });
  }
  return out;
}

module.exports = { FORMS, form, questionLabels, MAX_ANSWER };
