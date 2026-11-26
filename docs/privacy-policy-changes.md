# Privacy policy: what needs to change (2026-11-26)

Compared: the live policy (`/privacy-policy`, generated from the WordPress page) with what the site now does
(student area `/learn`, `/my`, the new checkout, ActiveCampaign automation, the admin). The page is generated, so
**change it in WordPress, then re-capture and regenerate** (`tools/rebuild/README.md`). Not legal advice: have the
final text checked by whoever advises Ashley on 개인정보보호법.

Items marked **[confirm]** are facts only Ashley's team knows.

---

## Summary of the gaps

| # | Section | Problem |
|---|---|---|
| 1 | 2. 처리하는 개인정보 항목 | Says 비밀번호; there is none now (email code). Missing: listening records, login device/session data, shipping address (checkout), review form answers, sales-call notes. |
| 2 | 3. 처리 목적 | Missing: progress saving / resume, lesson notices based on listening (reminders, "new week", completion). |
| 3 | 4. 보유 기간 | No periods for codes, sessions, listening records, request logs. |
| 4 | 6. 위탁 | Lists Brevo and 카페24 only. Missing: Vercel, Neon, Google (Gmail), ActiveCampaign, PayPal, Slack, Kakao, ManyChat. |
| 5 | (new) 국외 이전 | **Required and missing.** Almost every service above is outside Korea. |
| 6 | 8. 쿠키 | Generic. Must name the login cookie (30 days), the referral cookie (30 days) and the analytics/ad tools in Google Tag Manager. |
| 7 | 10. 안전성 확보 | "비밀번호 암호화" no longer applies; say what is actually done. |
| 8 | Top / 14 | No 시행일 (effective date). Add one and keep the previous version available. |

---

## Exact changes (Korean text to paste)

### 2. 처리하는 개인정보 항목: replace the first item, add four

Replace
> 회원 가입 및 서비스 이용 시필수 항목: 이름, 이메일 주소, 비밀번호(또는 소셜 로그인 식별값), 휴대전화 번호

with
> 프로그램 신청 및 결제 시: 이름, 이메일 주소, 휴대전화 번호, 주소(국가, 우편번호, 주소)

Add:
> 강의 수강(내 강의실) 이용 시: 이메일 주소, 로그인 인증 코드(암호화하여 저장), 로그인 기기 정보(브라우저 종류), 강의별 재생 위치·들은 시간·완료 여부
>
> 후기 작성 시: 이름(또는 비공개 요청 여부), 이메일 주소, 후기 및 설문 응답 내용
>
> 상담 및 수강 신청 과정에서: 상담 내용 기록, 수강 전·후 설문 응답(프로그램 개선 및 수강생 이해를 위한 내부 자료)
>
> 추천(리퍼럴) 이용 시: 추천 코드, 추천으로 이루어진 주문 및 보상 내역

### 3. 처리 목적: add to "서비스 제공 및 운영"

> 수강 진도 저장 및 이어 듣기, 강의 공개·수강 안내 메일 발송(수강 여부에 따른 안내 포함), 로그인 및 계정 보호(비정상적인 다중 기기 접속 확인)

### 4. 보유 기간: add

> 로그인 인증 코드: 발송 후 30일
> 로그인 기록(기기별 로그인 정보): 로그아웃 또는 만료 후 90일
> 로그인 요청 기록(암호화된 IP 정보): 30일
> 강의 수강 기록(재생 위치, 완료 여부): 수강 기간 종료 후 [confirm: e.g. 1년] 또는 삭제 요청 시까지

The site keeps listening records today without an end date: tell me the period Ashley wants and I'll add the
automatic deletion.

### 6. 위탁: replace the list

> 결제 처리: 사이다페이(신용카드 결제), PayPal Pte. Ltd.(해외 결제)
> 웹사이트 호스팅 및 서버 운영: Vercel Inc.
> 데이터베이스 및 파일 보관: Neon Inc.(데이터베이스), Vercel Inc.(파일 보관)
> 이메일 발송: Google LLC(로그인 코드 메일, Google Workspace), ActiveCampaign, LLC(수강 안내, 뉴스레터, 마케팅 이메일)
> 주소 검색: 카카오(우편번호 서비스)
> 주문 알림: Slack Technologies, LLC(운영팀 내부 알림)
> 인스타그램 메시지 응대: ManyChat, Inc.(대기자 명단 신청)
> [confirm] Brevo, 카페24: keep only if still used (WordPress hosting, older emails).

### (new section, after 6) 개인정보의 국외 이전

Required by 개인정보보호법 제28조의8 when data is stored or processed abroad. Suggested text:

> 회사는 서비스 제공을 위하여 아래와 같이 개인정보를 국외로 이전(위탁·보관)하고 있습니다. 이전은 서비스 이용 시점에 정보통신망을 통하여 이루어집니다.
>
> | 이전받는 자 (연락처) | 이전 국가 | 이전 항목 | 목적 | 보유 기간 |
> |---|---|---|---|---|
> | Vercel Inc. ([confirm 연락처]) | 미국 (서버: 대한민국 서울 리전 포함) | 웹사이트 이용 기록, 주문·수강 정보 | 웹사이트 및 서버 운영 | 위탁 계약 종료 시까지 |
> | Neon Inc. ([confirm 연락처]) | 싱가포르 | 이름, 이메일, 주문·결제 기록, 수강 기록 | 데이터베이스 보관 | 4번 보유 기간 |
> | Google LLC | 미국 | 이메일 주소, 로그인 코드 | 로그인 코드 메일 발송 | 발송 후 [Google 정책] |
> | ActiveCampaign, LLC | 미국 | 이름, 이메일, 구매·수강 정보(태그) | 수강 안내 및 마케팅 메일 | 회원 탈퇴 또는 동의 철회 시까지 |
> | PayPal Pte. Ltd. | 싱가포르 | 이름, 이메일, 결제 정보 | 해외 결제 | PayPal 정책 및 법령에 따름 |
> | Slack Technologies, LLC | 미국 | 구매자 이름, 상품명, 주문번호 | 운영팀 주문 알림 | [confirm] |
> | ManyChat, Inc. | 미국 | 인스타그램 계정명, 이메일 | 대기자 명단 응대 | [confirm] |
>
> 이용자는 국외 이전을 거부할 수 있으나, 이 경우 결제, 강의 수강 등 해당 서비스를 이용할 수 없습니다. 거부 및 문의는 hello@ashleylim.com 으로 해 주세요.

[confirm] each company’s privacy contact (from its own privacy policy); Neon's region is Singapore (AWS ap-southeast-1, checked in the database
address); Vercel runs the site in Seoul (icn1) but is a US company.

### 8. 쿠키: add after the first paragraph

> 회사가 사용하는 쿠키는 다음과 같습니다.
> - 로그인 유지 쿠키(필수): 내 강의실·내 주문 로그인 상태를 30일 동안 유지합니다. 들어올 때마다 다시 30일로 연장됩니다.
> - 추천 코드 쿠키: 추천 링크로 들어온 경우 30일 동안 추천 코드를 기억해 결제 시 적용합니다.
> - 분석·광고 도구: Google 태그 관리자를 통해 [confirm: Google Analytics, Meta 픽셀 등 실제 사용하는 도구]를 사용합니다. 로그인 후의 수강 페이지와 주문 페이지에는 설치하지 않습니다.
> - Vercel Web Analytics: 쿠키 없이 방문 통계를 수집합니다.

### 10. 안전성 확보: replace the technical line

> 기술적 조치: 비밀번호를 사용하지 않는 이메일 인증 로그인, 로그인 코드와 로그인 정보의 암호화(해시) 저장, IP 주소의 암호화 처리, 전송 구간 암호화(HTTPS), 관리자 페이지 접근 제한

### Top or section 14: effective date

> 시행일: 2026년 [ ]월 [ ]일 (이전 개인정보 처리방침은 [link]에서 확인할 수 있습니다.)

---

## Before switching on

- **Abandoned-checkout emails** (Shop → Settings, off today): before turning them on, add to section 3:
  "결제를 완료하지 않은 주문의 이메일로 결제 안내 메일 발송(1회)". They stay off until then.
- If Kakao login is added later: add 카카오 (로그인) to sections 2 and 6 (Kakao is in Korea, so not in the 국외 이전 table).
