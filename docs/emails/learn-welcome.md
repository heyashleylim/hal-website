# Student area emails (ActiveCampaign)

Drafts, rewritten 2026-11-26 for the web player (no podcast app any more), for Ashley's team to review and paste into
ActiveCampaign. Students listen in 내 강의실 (www.ashleylim.com/learn) only; saved on the home screen it is called
"애슐리 림의 수업" by default.

Personalization tags: `%FIRSTNAME%` (AC First name, the Korean full name, e.g. 김지연), `%EMAIL%`,
`%PODCAST_LINK%` (filled by the site: one tap signs the student into 내 강의실; the field keeps its old name so the
automations keep working). Make each button link exactly `%PODCAST_LINK%`.

---

## 1. Welcome (automation that starts with the tag `podcast_nsmb_enrolled`)

One automation per program: for another program, change the program name in the subject and the first lines.

**Subject:** 내성만방 수업이 시작돼요 💌

**Preheader:** 버튼 하나로 내 강의실에 들어갈 수 있어요.

**Body:**

%FIRSTNAME%님, 안녕하세요.
애슐리예요.

내성만방에 오신 걸 진심으로 환영해요.

앞으로 12주 동안의 강의는 모두 ‘내 강의실’에서 들을 수 있어요.
아래 버튼을 누르면 로그인 없이 바로 들어가져요.

[ 내 강의실 열기 ]  → %PODCAST_LINK%

처음 들어가면 휴대폰 홈 화면에 저장하는 방법이 보여요.
저장해 두면 앱처럼 아이콘으로 바로 열리고,
화면을 꺼도 계속 들을 수 있어요.
아이콘 이름은 ‘애슐리 림의 수업’으로 들어가 있는데,
원하는 이름으로 바꿔도 괜찮아요.

강의는 기수 일정에 맞춰 하나씩 열려요.
어디까지 들었는지는 자동으로 기억되니까,
휴대폰에서 듣다가 컴퓨터에서 이어 들어도 돼요.

다른 기기에서 들어갈 때는 www.ashleylim.com/learn 에서
신청할 때 쓴 이메일(%EMAIL%)을 입력해 주세요.
6자리 로그인 코드가 메일로 와요. 비밀번호는 필요 없어요.

자세한 사용법은 이용 안내에 정리해 두었어요.
www.ashleylim.com/learn/help

궁금한 점은 hello@ashleylim.com 으로 편하게 보내 주세요.

이제 시작이에요.

Love, 애슐리

---

## 2. New sign-in link (automation that starts with the tag `podcast_link_reset`)

Sent when the admin presses "Reset link" on a student (e.g. signed in on many devices). The old link stops working and
the student is signed out on every device.

**Subject:** 내 강의실 새 링크예요

**Preheader:** 이전 링크는 더 이상 열리지 않아요.

**Body:**

%FIRSTNAME%님, 안녕하세요.

안전을 위해 내 강의실 링크를 새로 만들었어요.
이전 링크는 더 이상 열리지 않고,
로그인되어 있던 기기에서도 다시 로그인해 주셔야 해요.

아래 버튼을 누르면 바로 들어가져요.

[ 내 강의실 열기 ]  → %PODCAST_LINK%

홈 화면에 저장해 둔 아이콘으로 들어갈 때는
신청할 때 쓴 이메일(%EMAIL%)을 입력하고
메일로 온 6자리 코드로 로그인해 주세요.

들은 진도는 그대로 남아 있어요.

궁금한 점은 hello@ashleylim.com 으로 편하게 보내 주세요.

Love, 애슐리
