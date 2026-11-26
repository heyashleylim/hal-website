# Student area welcome email (ActiveCampaign)

Draft, 2026-11-26, for Ashley's team to review and paste into ActiveCampaign. For now the student area only plays the
recorded lessons as audio (no video yet), so the email only talks about listening.

- Every link points to the plain address **https://www.ashleylim.com/learn**. There is no personal link: students sign
  in there with the email they bought with and a 6-digit code (Alex, 2026-11-26).
- Help page: https://www.ashleylim.com/learn/help
- Saved on a phone's home screen, the student area is called "애슐리 림의 수업" by default.
- Personalization tags: `%FIRSTNAME%` (AC First name, the Korean full name, e.g. 김지연) and `%EMAIL%`.
- The old "new link" email (tag `podcast_link_reset` / `learning_link_reset`) is no longer needed: turn that
  automation off.

---

## Welcome (automation that starts with the tag `learning_nsmb_enrolled`)

One automation per program: for another program, change the program name in the subject and the first lines, and the
tag (`learning_<program>_enrolled`).

**Subject:** 내성만방 강의, 이제 들을 수 있어요 🎧

**Preheader:** 신청할 때 쓴 이메일로 바로 시작할 수 있어요.

**Body:**

%FIRSTNAME%님, 안녕하세요.
애슐리예요.

내성만방에 오신 걸 진심으로 환영해요.

녹음된 강의는 오디오로 들을 수 있어요.
아래 버튼을 눌러 들어가 주세요.

[ 강의 듣기 ]  → https://www.ashleylim.com/learn

처음 들어가면 이메일을 입력하는 칸이 보여요.
신청할 때 쓴 이메일(%EMAIL%)을 입력하면
6자리 로그인 코드가 메일로 와요.
비밀번호는 필요 없어요.

한 번 로그인하면 그 기기에서는 30일 동안 로그인이 유지되고,
들어올 때마다 다시 30일로 늘어나요.

강의는 기수 일정에 맞춰 한 주씩 열려요.
어디까지 들었는지 자동으로 기억되니까,
멈췄다가 언제든 이어서 들으면 돼요.
휴대폰에서 듣다가 컴퓨터에서 이어 들어도 괜찮아요.

휴대폰으로 들으신다면 홈 화면에 저장해 두세요.
앱처럼 아이콘으로 바로 열리고,
화면을 꺼도 계속 들을 수 있어요.
아이콘 이름은 ‘애슐리 림의 수업’으로 들어가 있는데,
원하는 이름으로 바꿔도 괜찮아요.

홈 화면에 저장하는 방법과 자세한 사용법은
이용 안내에 정리해 두었어요.
👉 https://www.ashleylim.com/learn/help

코드 메일이 오지 않으면 스팸함을 먼저 확인해 주시고,
궁금한 점은 hello@ashleylim.com 으로 편하게 보내 주세요.

이제 시작이에요.

Love, 애슐리
