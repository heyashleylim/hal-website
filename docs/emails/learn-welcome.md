# Welcome email for the student area (ActiveCampaign)

Draft, 2026-11-15, for Ashley's team to review and paste into the AC automation that starts with the tag
`podcast_nsmb_enrolled` (one automation per program: change the program name for others).
It replaces the old "subscribe to the private podcast" welcome email.

Personalization tags used: `%FIRSTNAME%` (AC First name, the Korean full name, e.g. 김지연), `%EMAIL%`,
`%PODCAST_LINK%` (filled by the site: one tap signs the student into 내 강의실; old links still work).
Make the button link exactly `%PODCAST_LINK%`.

---

**Subject:** 내성만방 내 강의실이 열렸어요 💌

**Preheader:** 버튼 하나로 바로 들어갈 수 있어요.

**Body:**

%FIRSTNAME%님, 안녕하세요.
애슐리예요.

내성만방에 오신 걸 진심으로 환영해요.

이번 기수의 모든 강의는 ‘내 강의실’에서 들을 수 있어요.
아래 버튼을 누르면 바로 들어가져요.

[ 내 강의실 열기 ]  → %PODCAST_LINK%

휴대폰으로 들으신다면, 처음 들어간 뒤 꼭 홈 화면에 저장해 주세요.
앱처럼 아이콘으로 바로 열리고, 화면을 꺼도 계속 들을 수 있어요.
저장하는 방법은 내 강의실 첫 화면에 나와 있어요.

다른 기기에서 들을 때는 www.ashleylim.com/learn 에서
신청할 때 쓴 이메일(%EMAIL%)을 입력해 주세요.
로그인 코드가 메일로 와요. 비밀번호는 필요 없어요.

강의는 기수 일정에 맞춰 차례로 열려요.
들은 곳은 자동으로 기억되니까, 언제든 멈췄던 곳부터 이어 들으면 돼요.

궁금한 점은 hello@ashleylim.com 으로 편하게 보내 주세요.

이제 시작이에요.

Love, 애슐리

---

## Link reset email (tag `podcast_link_reset`)

**Subject:** 내 강의실 새 링크예요

%FIRSTNAME%님, 안녕하세요.

안전을 위해 내 강의실 링크를 새로 만들었어요.
이전 링크는 더 이상 열리지 않고, 다른 기기에서도 다시 로그인해 주셔야 해요.

[ 내 강의실 열기 ]  → %PODCAST_LINK%

Love, 애슐리
