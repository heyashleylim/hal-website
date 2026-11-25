/*
 * Review forms of the Students section: their questions (Korean as asked, with the hint under each, and English for
 * the admin) and the CSV columns of the old form's export. Used by the review form page (/lifeartist/review, its
 * labels must match: tests/students/reviews.test.js), the endpoint that saves it (api/review.js), the CSV import in
 * the admin, and the admin pages. A new review form = a new entry here (and a page).
 */
const FORMS = {
  'lifeartist-2026': {
    program: 'lifeartist',
    cohort: 1,
    title: 'Life Artist 2026 review',
    title_ko: '라이프 아티스트 2026 후기',
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
