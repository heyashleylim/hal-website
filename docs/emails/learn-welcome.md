# Student area emails (ActiveCampaign)

Drafts, rewritten 2026-11-26, for Ashley's team to review and paste into ActiveCampaign. For now the student area only
plays the recorded lessons as audio (no video, no podcast app), so the emails only talk about listening.
Saved on a phone's home screen, it is called "애슐리 림의 수업" by default.

Personalization tags: `%FIRSTNAME%` (AC First name, the Korean full name, e.g. 김지연), `%EMAIL%`,
`%LEARNINGLINK%` (filled by the site: one tap signs the student in and opens their lessons).
Make each button link exactly `%LEARNINGLINK%`. The help page is www.ashleylim.com/learn/help.

---

## 1. Welcome (automation that starts with the tag `learning_nsmb_enrolled`)

One automation per program: for another program, change the program name in the subject and the first lines, and the
tag (`learning_<program>_enrolled`).

**Subject:** 내성만방 강의, 이제 들을 수 있어요 🎧

**Preheader:** 버튼 하나로 바로 들을 수 있어요.

**Body:**

%FIRSTNAME%님, 안녕하세요.
애슐리예요.

내성만방에 오신 걸 진심으로 환영해요.

녹음된 강의는 오디오로 들을 수 있어요.
아래 버튼을 누르면 로그인 없이 바로 들어가져요.

[ 강의 듣기 ]  → %LEARNINGLINK%

강의는 기수 일정에 맞춰 한 주씩 열려요.
어디까지 들었는지 자동으로 기억되니까,
멈췄다가 언제든 이어서 들으면 돼요.
휴대폰에서 듣다가 컴퓨터에서 이어 들어도 괜찮아요.

휴대폰으로 들으신다면 홈 화면에 저장해 두세요.
앱처럼 아이콘으로 바로 열리고,
화면을 꺼도 계속 들을 수 있어요.
아이콘 이름은 ‘애슐리 림의 수업’으로 들어가 있는데,
원하는 이름으로 바꿔도 괜찮아요.

다른 기기에서 들을 때는 www.ashleylim.com/learn 에서
신청할 때 쓴 이메일(%EMAIL%)을 입력해 주세요.
6자리 로그인 코드가 메일로 와요. 비밀번호는 필요 없어요.

홈 화면에 저장하는 방법과 자세한 사용법은
이용 안내에 정리해 두었어요.
👉 www.ashleylim.com/learn/help

궁금한 점은 hello@ashleylim.com 으로 편하게 보내 주세요.

이제 시작이에요.

Love, 애슐리

---

## 2. New sign-in link (automation that starts with the tag `learning_link_reset`)

Sent when the admin presses "Reset link" on a student (e.g. signed in on many devices). The old link stops working and
the student is signed out on every device.

**Subject:** 강의 듣기 링크가 새로 바뀌었어요

**Preheader:** 이전 링크는 더 이상 열리지 않아요.

**Body:**

%FIRSTNAME%님, 안녕하세요.

안전을 위해 강의 듣기 링크를 새로 만들었어요.
이전 링크는 더 이상 열리지 않고,
로그인되어 있던 기기에서도 다시 로그인해 주셔야 해요.

아래 버튼을 누르면 바로 들을 수 있어요.

[ 강의 듣기 ]  → %LEARNINGLINK%

홈 화면에 저장해 둔 아이콘으로 들어갈 때는
신청할 때 쓴 이메일(%EMAIL%)을 입력하고
메일로 온 6자리 코드로 로그인해 주세요.

들은 진도는 그대로 남아 있어요.

로그인 방법은 이용 안내에서도 볼 수 있어요.
👉 www.ashleylim.com/learn/help

궁금한 점은 hello@ashleylim.com 으로 편하게 보내 주세요.

Love, 애슐리
