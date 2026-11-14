# E-commerce — moving checkout, orders and products off WordPress

Status: **approved by Alex on 2026-11-10. Phase 1 done; phase 2 built on the `shop` branch (2026-11-11) and waiting for
the real-payment tests of section 10.**
Open points left are listed in section 8.

Goal: retire WordPress and WooCommerce completely. Products, checkout, payments, orders, refunds, coupons, tax
records and a referral program run on this site (Vercel + GitHub + Neon), managed from a new **Shop** section
in `/admin`, and kept in sync with ActiveCampaign (AC). The checkout is a single focused page in the
ThriveCart / ClickFunnels style: Korean from the first label to the last error message, mobile-first, with the
Kakao address search built in.

Sources: the CiderPay gateway plugin (`woocommerce-gateway-ciderpay.php` v3.0.0, `ciderpay-blocks.js`), the
three code snippets (direct checkout, Kakao postcode, Slack alert), the Additional CSS, the WooCommerce
settings and product screenshots, and CiderPay's API documentation (http://uddocs.net/v/ciderpay, both the
공개 API and 개발사 API groups, read 2026-11-10).

## Phases

| Phase | Contents | Done when |
|---|---|---|
| **0. Inventory** | WordPress exports, the list of what tags AC today, PayPal app + sandbox, accountant's answers. | The open points of section 8 that block a phase are cleared. |
| **1. Foundations** ✅ 2026-11-10 | Migration `005`, pricing + ledger modules with tests, Shop admin: Products, Orders (read), Settings. | A product can be created in the admin and quoted by the API. |
| **2. Checkout, pay in full** (built 2026-11-11, section 10) | Checkout page, Kakao search, CiderPay pay-in-full, PayPal, notices, thank-you page, Slack, AC sync for purchases, dataLayer. | A real ₩1,000 payment and a sandbox $ payment go through on a preview, end to end. **Still to do: Alex's tests in section 10.** |
| **3. Instalments, refunds, coupons** | CiderPay recurring, schedule, failed-instalment alerts, automatic stop, one-click refunds with the full chain, shared and individual coupons with AC, manual orders. | The section 5 manual script passes. |
| **4. Tax & reports + import** | Reports, CiderPay check, exports, WooCommerce import into the ledger. | Ashley can read a past quarter's figures in the admin and they match CiderPay. |
| **5. Go live** | Section 6, steps 3–6. Vercel Pro. | No payment link points to WordPress. |
| **6. Referrals + `/my`** | Referral links, friend discount and bonus, rewards, cash / credit, payouts, customer page. Then server-side conversions, abandoned-checkout tags, order bump. | A test referral earns, is approved after the window and shows in a payout list. |
| **7. Bare domain, retire WordPress** | Section 6, steps 7–8. | Hosting cancelled. |

---

---

## 1. What WordPress does today, and where each piece goes

| Today (WordPress / WooCommerce) | How it works now | In the new build |
|---|---|---|
| **Products** | One WooCommerce product per currency: KRW `2148`, `2882` (NSMB), `3110`, `5783`; USD `4536` (NSMB), `5082`, `5249`, `5784`, plus a USD test product `7910`. Virtual, hidden from the catalogue. Prices include 10% VAT. | One product with a KRW price and an optional USD price, edited in `/admin/shop/products`. |
| **Direct checkout links** | `ashleylim.com/?product=<id>&currency=KRW\|USD[&plan=instalment]`: a snippet empties the cart, adds the product, forces the WCML currency with two cookies and redirects to `/checkout`. | `/checkout/<product>` (`?currency=usd`, `?plan=instalment`). No cart, no cookies. The old links redirect (section 6). |
| **Currency → payment method** | "Conditions" plugin: USD products allow PayPal only, everything else CiderPay only. | A rule in the product: KRW → card (CiderPay), USD → PayPal. |
| **Card payments (CiderPay)** | Custom plugin. Creates a CiderPay payment, redirects to CiderPay's page, and marks the order paid when CiderPay calls `/wp-json/ciderpay/v1/confirmation`. | `api/_lib/shop/pay/ciderpay.js`, same CiderPay API, used more fully (section 3.2). |
| **Instalments (할부)** | Three product fields (first payment, count, amount). NSMB today: ₩930,000 now + 2 × ₩930,000 monthly (₩2,790,000) against ₩2,690,000 in full. Uses CiderPay's recurring payment (`regularPay`); each monthly charge creates a child order. | An instalment plan on the product, and a real schedule per order: expected date, paid date, failure alert. |
| **PayPal** | WooCommerce PayPal Payments plugin, express buttons hidden by CSS. PayPal offers its own instalments to the buyer inside PayPal. | PayPal Orders API (create + capture on our server) with PayPal's button, and the instalment option announced on our page before the buyer leaves (D10). |
| **Kakao address search** | A snippet polls the WooCommerce block until the postcode field exists, injects a "우편번호 찾기" button, opens a **pop-up**, then pushes values into React inputs. It breaks whenever WooCommerce changes its markup. | Part of the form itself: the search opens **inline** under the field (Daum Postcode `embed`, no pop-up), fills postcode and address, and moves focus to the detail-address field. |
| **Checkout look** | WooCommerce Checkout block + 100 lines of `!important` CSS overrides. Parts stay in English (the CiderPay description, every plugin error message, "Tax"). | Our own page on `brand.css` tokens. Every string lives in one Korean copy file. |
| **Slack "You've got MONEY!"** | Sent by the CiderPay plugin, and by a snippet for other gateways. Webhook URLs sit in WooCommerce settings. | One notifier for every payment, refund and failed instalment. URLs in Vercel env vars. |
| **Order emails** | WooCommerce's built-in emails. | ActiveCampaign automations, triggered by the site (D4, section 3.4). |
| **ActiveCampaign purchase tags** | The ActiveCampaign plugin for WooCommerce adds one tag per product: `purchased_eft`, `purchased_chosen_2026`, `purchased_switch`, `purchased_nsmb_XX_YYYYMM` (cohort number and month). The podcast enrolment and Ashley's automations start from these. | The site adds **the same tags**, set per product in the admin (section 3.4), so no existing automation loses its trigger. |
| **Coupons** | WooCommerce coupons ("쿠폰 추가"). | Shared codes and individual codes, synced to AC (section 3.6). |
| **Tax and sales figures** | WooCommerce orders and reports are the record Ashley uses for the Korean business. | A ledger and tax reports in the admin (section 3.7). |
| **Customer accounts** | WooCommerce "my account" (the instalment code creates WP users silently). | No passwords. "내 주문" page by emailed link (D6). |

### Problems in the current setup that the rebuild fixes

1. **The CiderPay callback isn't verified**: anyone who knows the URL can mark an order as paid. (Alex,
   2026-11-10: not to be fixed on WordPress; solved by the rebuild.)
2. **Instalment amounts come from the buyer's browser** and are used as-is. In the new build the browser sends
   only "product, plan, coupon" and the server works out every amount.
3. **Nobody notices a missed instalment.** CiderPay does send a failure notice (`errorRpPayment`); the current
   plugin ignores it.
4. **The instalment plan has no real stop.** It ends through an end date (today + N months + 7 days). The new
   build cancels the agreement at CiderPay (`destroyMp`) as soon as the last instalment is received.
5. **Refunds are manual** in CiderPay's dashboard, then again in WooCommerce, then again in AC.
6. **The order is found by reading `[1234]` out of the product name.** CiderPay offers free variables
   (`var1`, `var2`, `payVar1`, `payVar2`) that come back with every notice; the new build uses those.
7. **Two products per program** (KRW and USD), two cookies and a cache exception to make the currency stick.
8. **Mixed languages** and a checkout that can't be designed, only overridden.

---

## 2. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Card provider** | ✅ Keep CiderPay. The card step stays on CiderPay's page; everything around it is ours. The payment code sits behind one small interface so another provider can be added later. |
| D2 | **Billing address** | ✅ Kept, with the Kakao search inline. |
| D3 | **Outside scripts on the checkout page.** The repo rule is "no new third-party script without asking". | ✅ One only: Kakao's address search (`t1.kakaocdn.net`; Kakao closes the old `t1.daumcdn.net` address on 2026-11-30). PayPal needs no script after all: the buyer is sent to PayPal's own page and back, like CiderPay (section 10). No new npm package. |
| D4 | **Order emails** | ✅ Through ActiveCampaign automations, triggered by tags and fields the site sets. |
| D5 | **Referral or affiliate** | ✅ Customer referral program (추천 프로그램). The engine can take approved outside partners later. |
| D6 | **Customer accounts** | ✅ No passwords: `/my` sends a sign-in link by email. |
| D7 | **Order history** | ✅ Import past WooCommerce orders and customers (also needed for a complete tax year, section 3.7). |
| D8 | **Vercel plan** | ✅ Build and test on Hobby; move to Pro when the checkout is ready to go live. Built to fit Hobby meanwhile: 3 new functions (9 in total, limit 12) and the existing daily cron. |
| D9 | **Language** | ✅ Korean only, for KRW and USD buyers. |
| D10 | **USD instalments** | ✅ USD is PayPal only, and PayPal's own instalments are the instalment option. The checkout says so, in our own words, before the buyer reaches PayPal (3.2). |
| D11 | **Conversion tracking** | ✅ Must be seamless and reliable. See 3.8. |
| D12 | **Legal texts** | ✅ Ashley / legal provide the wording; Claude suggests pages and mentions when asked. The refund window is **14 days** (Alex, 2026-11-10). |
| D13 | **Admin language** | ✅ English. Everything a customer sees is Korean. |
| R1 | **Referral reward: % or fixed** | ✅ Both, chosen per product (and changeable per campaign). |
| R2 | **What the friend gets** | ✅ Configurable per product: a discount, a bonus (access to other programs chosen in the admin), or both. |
| R3 | **Cash or credit** | ✅ The referrer chooses. Cash needs the accountant's rules first (section 8). |
| R4 | **Who can refer** | ✅ Every customer, automatically. |
| R5 | **Cookie, payout rhythm** | ✅ 30 days, monthly payout, after the 14-day refund window. |
| R6 | **Terms and disclosure** | ⏳ Later. Claude will propose the pages and mentions. |

---

## 3. What gets built

### 3.1 Checkout page `/checkout/<product>`

One page, one job. No site navigation, no footer menu, nothing to click except paying.

**Layout**

- **Phone (designed first):** logo → compact order line (product, total; tap to expand what's included) →
  form → pay button that stays in reach. Inputs 16px+ (no iOS zoom), 48px tall, right keyboard per field
  (`inputmode`, `autocomplete`), one column.
- **Desktop:** two columns. Left: the form. Right, sticky: product image, what's included, price, guarantee,
  one or two testimonials (verbatim, chosen with ashley-lim-market), secure-payment note.

**Form, top to bottom**

1. **내 정보**: 이름, 이메일, 휴대폰 번호. Phone formats itself (010-0000-0000); email gets a typo hint
   ("gmail.con → gmail.com?"). One name field, as today. (CiderPay requires the phone number.)
2. **주소**: one "주소 검색" field. Tapping it opens the Kakao search right there in the page; choosing a result
   fills 우편번호 + 도로명 주소 and puts the cursor in 상세 주소. No pop-up window, no separate city field.
   USD buyers (abroad) get plain address fields with a country list, since the Kakao search only knows Korean
   addresses.
3. **결제 방법**: large selectable cards, not small radio buttons.
   - 일시불: `₩2,690,000`
   - 할부: `오늘 ₩930,000 · 이후 매월 ₩930,000 × 2회` with the total underneath, only when the product has a plan.
     `?plan=instalment` preselects it, as today.
   - "해외 결제 · PayPal (USD)" switches the page to the USD price when the product has one, and shows that
     PayPal lets the buyer split the payment (3.2).
4. **쿠폰** collapsed behind "쿠폰이 있으신가요?". A code arriving in the link (`?coupon=…`, as AC emails will
   send it) is applied without typing.
5. **Add-ons / order bump**: built 2026-11-13, ahead of phase 6 (Alex). Cards with "+ 추가" between the payment
   method and the order, up to 6 per product (see CLAUDE.md → Shop → Add-ons).
   **Pricing options** (기본 / VIP…) and the card/PayPal choice: built 2026-11-14 (Alex), right before the payment
   method (see CLAUDE.md → Shop → Pricing options). Instalment plans will join the same picker in phase 3.
6. **Consent line + pay button** with the amount on it: `₩930,000 결제하기`. Under it: the guarantee line and the
   secure-payment note (wording by Ashley).

**Behaviour**

- Errors appear under the field, in Korean, when the field is left; the button never fails silently.
- Typed values survive a reload or coming back from the payment page (kept in the browser only).
- While the payment page is being prepared, the button shows progress and can't be pressed twice.
- Product not on sale (closed, or outside its sale dates): the page says so and links back to the program page
  or its waitlist.
- Works without JavaScript for card payment (plain form post, plain address fields); the Kakao search and
  PayPal need JavaScript.
- CLAUDE.md conventions apply: labels on every input, focus rings, 44px targets, contrast,
  `prefers-reduced-motion`, no horizontal scroll at 375px.

**After payment**

- `/checkout/complete?o=<order token>`: waits for the provider's confirmation (a few seconds), then shows the
  thank-you: what was bought, what happens next, the receipt link, and **the buyer's own referral link**.
- Cancelled or failed: back to the checkout with the form still filled and a clear message.
- `/checkout/*` pages are `noindex`.

### 3.2 Payments

**CiderPay (KRW)**, from its documentation:

| Step | CiderPay API | Notes |
|---|---|---|
| Pay in full | `POST /oapi/payment/request` → `payUrl` | Our order id and a signature travel in `var1` / `var2` and come back in the notice. `taxPrice` states the taxable amount. `returnmode: JUST` returns straight to our thank-you page. |
| Paid notice | feedback `paymentState=COMPLETE` | Brings `orderNo` and `feedbackToken` (needed for refunds), `approvalNo`, card company, masked card number, `cardQuota` (card instalment months) and `csturl` (the receipt). All stored. |
| Instalment plan | `POST /oapi/regularPay/request` with `firstPrice`, monthly `price`, `firstBillingType: MUST_FIRST_PAYMENT` | Our ids in `var1/var2` and `payVar1/payVar2`. |
| Plan agreed / refused | feedback `agreeRegularPayment` / `rejectRegularPayment` | `rpToken` stored: it is the handle to pause, change or stop the plan. |
| Each monthly charge | feedback `completeRpPayment` with `turnSeq` | Marks that instalment paid; stores `orderNo`, `feedbackToken`, `csturl`. |
| **Failed monthly charge** | feedback **`errorRpPayment`** with `errorMessage` | Triggers the missed-instalment flow below, immediately. |
| End of plan | `DELETE /oapi/regularPay/destroyMp/{memberID}/{rpToken}` | Called when the last instalment is received, and on refund or cancellation. |
| Pause / resume | `pauseAct` / `unpauseAct` | Admin buttons, for a customer who asks for time. |
| Refund before settlement | `POST /oapi/payment/cancel` (`rangeType` `ALL` / `PART`, `cancelPrice`) | Immediate. |
| Refund after settlement | `POST /oapi/payment/cancelRequest` | A request: the order shows "refund requested" until CiderPay confirms (`paymentState=CANCEL`). The admin tries `cancel` first and falls back to this when CiderPay answers `CANCEL_REQ`. |
| VAT figures | `GET /oapi/pv/payment/tax-doc` (quarter or half-year) | Used to check our tax report against CiderPay's (3.7). |

- The documentation has **no "look up a payment" call and no test mode**. So a notice is trusted only when its
  signature (`var2`), order, amount and state all match ours, and each `approvalNo` / `orderNo` is accepted once.
  Testing uses real small payments (₩1,000 is CiderPay's minimum), refunded afterwards.
- Refunds or cancellations made directly in CiderPay's dashboard come back as a `CANCEL` notice and update the
  order the same way.

**PayPal (USD)**

- Orders API: the order is created and captured by our server (the browser never decides the amount), with a
  webhook as a safety net. Refunds (full or partial) from the admin through PayPal's refund API; refunds and
  disputes made inside PayPal come back by webhook.
- **Instalments shown before PayPal:** the PayPal business account is Korean (Alex, 2026-11-10). PayPal's own
  "Pay Later" banner is only offered to merchant accounts in a few countries, and Korea isn't among them as far
  as PayPal's documentation shows, so the line is ours: the PayPal payment card on the checkout says, in Korean,
  that PayPal offers instalment payment during its own step (wording set in Settings, by Ashley). Whether a given
  buyer is offered instalments is PayPal's decision (their country and account), so the wording must not promise
  it. The business receives the full amount at once either way, so the order is simply "paid".

**Missed instalment** (asked for explicitly)

1. CiderPay's failure notice arrives → the instalment becomes `failed`, the plan `overdue`.
2. **Slack message to Alex and Ashley at once** (who, which program, which instalment, amount, CiderPay's
   error message, link to the order).
3. AC: tag `instalment_failed_<product>` and fields (amount, date) so an automation can email the customer.
4. The order appears under "Needs attention" in the admin, with actions: send a one-off payment link for that
   amount, pause the plan, stop the plan, mark as settled by hand.
5. **Silent failures** (they happen today: a charge fails and nothing is sent): every morning the site checks
   each running plan against its schedule and raises the same alert for any instalment whose date has passed
   without a "paid" notice. This check doesn't depend on CiderPay telling us anything. Once on Vercel Pro it runs
   hourly instead of daily.
6. When the amount is finally received: tags cleared, plan back to `active`, Slack confirmation.

**Refund or cancellation: one click, everything follows**

1. Admin → order → Refund (full, partial, or one instalment) with a reason.
2. Money: CiderPay cancel / cancel request, or PayPal refund.
3. Instalment plan stopped at CiderPay (`destroyMp`) when the order is cancelled.
4. Order, payments and the tax ledger updated (a negative line, never an edit of the original).
5. ActiveCampaign: `refund_<product>` tag, `purchased_…` tag removed, refund fields set → Ashley's refund email goes
   out; the podcast access is revoked through the existing revoke path.
6. Referral reward for that order cancelled; bonus access given to a referred friend withdrawn.
7. Slack message. Activity log entry.

- All amounts are whole numbers (won; cents for USD) worked out on the server in one pure, unit-tested module
  (`api/_lib/shop/pricing.js`, like `release.js`).
- Card numbers never touch this site.
- An order with no payment within 24 hours becomes `expired` (daily job).

### 3.3 Admin: new section `/admin/shop`

Added to `SECTIONS` in `admin.js` with its own icon; API modules `api/_lib/admin/shop-*.js` registered in
`api/admin.js` (actions prefixed `shop-`); every button has a `data-tip`; every change lands in the activity log.

1. **Overview**: revenue today / 7 days / 30 days per currency, orders by product, and "Needs attention":
   payments awaiting confirmation, **failed or overdue instalments**, refunds requested but not yet confirmed,
   failed AC updates.
2. **Products**: name, URL slug, status (open / closed / scheduled dates), KRW price, USD price, instalment plan
   (first payment, monthly amount, count), image, "what's included" lines and checkout testimonials, AC tags for
   each event, thank-you page text, referral settings (reward type and amount, friend discount, friend bonus
   programs), the old WooCommerce ids (for redirects). "Copy checkout link" per variant.
3. **Orders**: search and filters (status, product, currency, date, plan). Order page: customer, amounts, VAT,
   payment timeline (every notice received), instalment schedule, receipts, coupon, referral, AC updates, notes.
   Actions: refund, stop / pause / resume instalments, send payment link, resend confirmation, mark paid by hand
   (bank transfer), create an order by hand, CSV export.
4. **Customers**: one row per email with all orders, total paid, podcast enrolments (link to the Podcast
   section), coupons, referral activity. Actions: send their "내 주문" link, export, delete personal data on request.
5. **Coupons**: section 3.6.
6. **Referrals**: section 3.5.
7. **Tax & reports**: section 3.7.
8. **Automation**: the AC tags and fields in use, the queue of updates with retry, the webhook addresses to
   paste into AC, a "send test" button (same pattern as the podcast's Automation page).
9. **Settings**: checkout texts, Slack on/off per event, business details for reports, CiderPay / PayPal
   connection status (keys stay in Vercel env vars, never in the database or the page).

### 3.4 ActiveCampaign: everything in sync

Same mechanism as the podcast: the site never calls AC while a customer waits. Each change is written to the
existing queue (`ac_outbox`, one entry per fact, retried until AC accepts it) and sent right after. The
Automation page shows every entry. Tag names use underscores like Ashley's other tags and are editable per
product in the admin; the names below are the defaults. `<product>` is the part after `purchased_` in the
product's purchase tag (e.g. `refund_nsmb_03_202701`), so every tag of one cohort reads alike.

**Tags the site adds (and removes when they stop being true)**

| Event | Tag | AC can then… |
|---|---|---|
| Email entered at checkout, no payment after 1 hour | `checkout_abandoned_<product>` | send a reminder (needs a line in the privacy policy; removed on purchase) |
| Paid (full, or first instalment) | The product's purchase tag, exactly as today: `purchased_eft`, `purchased_chosen_2026`, `purchased_switch`, `purchased_nsmb_XX_YYYYMM` (edited on the product for each new cohort), plus any extra tags set on the product | send the confirmation, start onboarding, enrol in the podcast |
| Instalment plan started / each instalment received / all received | `instalment_active_<product>`, `instalment_paid_<product>_<n>`, `instalment_completed_<product>` | remind before the next charge, thank at the end |
| Instalment failed | `instalment_failed_<product>` | ask the customer to update their card |
| Refund (full / partial) | `refund_<product>`, `refund_partial_<product>` | send the refund email, stop sequences |
| Order cancelled / plan stopped | `cancelled_<product>` | close the loop |
| Coupon issued / used | `coupon_issued_<campaign>`, `coupon_used_<campaign>` | send the code, stop reminders |
| Became a referrer / a friend bought / reward approved / reward paid | `referrer`, `referral_sale`, `referral_reward_approved`, `referral_reward_paid` | announce the program, congratulate, confirm payout |
| Bought through a friend's link | `referred_customer` | welcome differently |

**Contact fields the site keeps up to date** (for use inside Ashley's emails)

| Field | Value |
|---|---|
| `ORDER_NUMBER`, `ORDER_PRODUCT`, `ORDER_DATE`, `ORDER_TOTAL`, `ORDER_PLAN` | The latest order |
| `ORDER_RECEIPT_URL` | CiderPay's / PayPal's receipt for the latest payment |
| `ORDER_PAID_TOTAL` | Everything received so far for that order |
| `INSTALMENT_NEXT_DATE`, `INSTALMENT_NEXT_AMOUNT`, `INSTALMENT_REMAINING` | The running plan |
| `REFUND_AMOUNT`, `REFUND_DATE` | The latest refund |
| `MY_ORDERS_LINK` | Their `/my` page |
| `COUPON_CODE`, `COUPON_EXPIRES`, `COUPON_LINK` | Their personal coupon (3.6) |
| `REFERRAL_LINK`, `REFERRAL_CODE`, `REFERRAL_BALANCE` | Their referral link and reward balance |
| `CUSTOMER_TOTAL_SPENT`, `CUSTOMER_ORDER_COUNT` | For segments |

Also on every paid order: the contact is created or updated (name, phone) and added to the Master Contact List.

**AC → site** (webhooks, like `podcast-ac`): "generate a coupon for this contact" (3.6). Others can be added the
same way.

**Emails**: written and sent in AC by Ashley / Alex (confirmation, instalment reminder, failed instalment,
refund, coupon, referral). Section 7 lists the automations to create; Claude can draft the copy with
ashley-lim-voice when asked.

To check: AC's e-commerce "Deep Data" feature could also show orders and revenue on each contact inside AC. It
depends on the AC plan; tags and fields above work on every plan and are enough for the emails.

### 3.5 Referral program (추천 프로그램)

**For people**

- Every customer automatically gets a personal link, `/r/<code>`, shown on the thank-you page and in `/my`, and
  written to AC (`REFERRAL_LINK`).
- A friend who opens it lands on the program page; the code is remembered for 30 days (first-party cookie) and
  can also be typed at checkout.
- **The friend's benefit**, per product: a discount (% or fixed), a bonus (access to other programs picked in
  the admin, granted automatically through their AC tags), or both. It shows on the checkout as soon as the code
  is recognised.
- **The referrer's reward**, per product: a % of the amount paid or a fixed amount. `pending` until the 14-day refund
  window has passed, then `approved`; cancelled by a refund. For instalment orders it follows the money received.
- **Cash or credit, the referrer's choice** in `/my`: credit is applied automatically at their next checkout;
  cash is paid monthly by bank transfer (the bank details and tax information this requires are collected only
  from referrers who choose cash, once the accountant has confirmed the rules).
- `/my` shows the link, ready-to-send messages for KakaoTalk and Instagram (ashley-lim-voice), clicks, purchases
  and rewards (pending / approved / paid or used).

**Admin (`/admin/shop/referrals`)**: referrers and their numbers, each attributed order, rewards by status,
credit balances, the monthly payout list with CSV and "mark as paid", manual adjustments, pause or ban a
referrer, per-person custom rate (future partners), per-product settings with start and end dates for campaigns.

**Guard rails**: no self-referral (same email, phone or payer), last link wins, one referrer per order, rewards
only on money actually received, alerts on unusual patterns. Rewards paid in cash appear in the tax reports as
an expense (3.7).

### 3.6 Coupons

- **Shared codes** (one code many people use): % or fixed amount, products, dates, total and per-person limits.
- **Individual codes** (one per person, single use, tied to their email): generated
  - from the admin: for one customer, or in bulk for every contact with a given AC tag or list (a campaign name,
    discount, products and expiry are chosen once);
  - or by AC itself: an automation step calls the site's webhook ("generate a coupon for this contact", with the
    campaign name), so a sequence can hand out a fresh code at the right moment.
- Each individual code is written to the contact's AC fields (`COUPON_CODE`, `COUPON_EXPIRES`, `COUPON_LINK`: a
  checkout link with the code already applied) and tagged `coupon_issued_<campaign>`, so Ashley's email shows
  the person their own code. Using it adds `coupon_used_<campaign>`.
- One set of coupon fields per contact holds the latest code; earlier codes stay valid until they expire and
  are all visible in the admin and in `/my`.
- Admin list: code, campaign, owner, status (unused / used / expired), order, with export and "disable".
- Rules for combining a coupon with a referral discount or credit are set in Settings (default: the best single
  discount applies; credit can be added on top).

### 3.7 Tax and accounting records

The admin becomes the place Ashley opens to file taxes and justify every figure.

**The ledger.** Every movement of money is one permanent line, never edited or deleted (a correction is a new
line): date and time (KST), order, customer, product, kind (sale, instalment, refund, partial refund), payment
method, currency, amount, **supply amount (공급가액) and VAT (부가세)** for KRW, the provider's references
(CiderPay `orderNo` and `approvalNo`, card company, receipt URL; PayPal capture id, PayPal fee, net received)
and whether CiderPay has settled it.

**Reports (`/admin/shop/reports`)**

| Report | Shows |
|---|---|
| Sales by period | Month, quarter, half-year (the VAT periods) and year: approvals, cancellations and net, by payment method, with count, total, supply amount and VAT. Laid out like CiderPay's own VAT document so the two can be compared line by line. |
| CiderPay check | Pulls CiderPay's VAT figures for the same period (`tax-doc`) and highlights any difference with our ledger. |
| Foreign sales (USD / PayPal) | Per payment: USD amount, PayPal fee, net, date, buyer country, the exchange rate used and the won value, and how VAT was treated (see "What the research says" below). |
| By product, by customer | Revenue per program and cohort period; a statement per customer (useful for receipts and disputes). |
| Instalments outstanding | Money still due on running plans at a given date. |
| Refunds | Every refund with its original sale. |
| Referral rewards | Rewards approved and paid per person and month (an expense), credit granted and used. |
| Coupons and discounts | Discounts given, per campaign. |

- Every report exports to CSV that opens correctly in Korean Excel, with the order-level detail behind each total.
- Each order has a printable page (customer, product, amounts, VAT, payment references, receipt links) as a
  supporting document.
- **A complete year in one place:** the WooCommerce import (section 6) brings past orders *and their payments*
  into the ledger, marked `imported`, so the year of the switch isn't split across two systems.
- Card receipts and cash receipts are issued by CiderPay; the ledger keeps the link to each.
- **Nothing is ever deleted automatically**: orders, payments and ledger lines are kept indefinitely (Alex,
  2026-11-10).
- Backups: Neon point-in-time restore, plus an automatic monthly export of the ledger kept in Blob storage.

**What the research says (web search, 2026-11-10: pointers for the accountant, not tax advice)**

- **USD sales through PayPal are probably taxable at 10%, not zero-rated.** Zero-rating a service sold to a
  non-resident requires, among other conditions, that the payment arrives through a foreign-exchange bank. A
  National Tax Service ruling on online education sold to non-residents allows zero-rating on that condition,
  and tax practitioners write that money received through PayPal doesn't meet it. WooCommerce already treats
  the USD price as VAT-inclusive, so the default stays: **USD sales recorded as taxable, VAT included**. A
  per-product switch ("USD sales: taxable / zero-rated") lets the accountant's answer be applied without code.
- **Won value of a USD sale:** the VAT rules convert foreign currency at the official base rate (기준환율 /
  재정환율) of the supply date, or at the amount actually exchanged when it was converted before that date. The
  search didn't return the legal text itself, so the ledger stores the USD amount, the date, the rate used and
  where the rate came from, and the rate can be corrected per line before a period is closed.
- **Cash referral rewards to individuals** are normally "other income" (기타소득, a 사례금): 22% withheld
  (20% income tax + 2% local tax) with no deductible expenses, reported on a payment statement, which requires
  the recipient's resident registration number. A payment of ₩50,000 or less is under the taxation threshold
  (no withholding). Someone who refers repeatedly, as an activity, may instead be treated as business income
  (3.3% withheld). So: each cash payout records gross, tax withheld and net; the rate and threshold are settings;
  and the referrer's identification for the tax statement is collected by Ashley outside the site unless the
  accountant asks otherwise (the site should not store resident registration numbers).
- **Credit and discounts** aren't a payment to the referrer; they reduce the price of a later sale. How the
  accountant wants them shown is still to confirm, so the ledger keeps the full price, the credit used and the
  amount actually paid as separate figures.

Sources: [NTS ruling on zero-rating for services to non-residents](https://casenote.kr/%EA%B5%AD%EC%84%B8%EC%B2%AD/%EC%84%9C%EB%A9%B4%EC%9D%B8%ED%84%B0%EB%84%B7%EB%B0%A9%EB%AC%B8%EC%83%81%EB%8B%B43%ED%8C%80-616-adddca),
[ruling on online education sold to non-residents](https://www.ulex.co.kr/tax/%EB%B6%80%EA%B0%80460151313-256036),
[first overseas sales: tax points (PayPal and zero-rating)](https://blog.mstacc.com/columns/taxation/2948),
[zero-rating conditions, Seoul Economic Daily](https://www.sedaily.com/article/20073354),
[referral reward as other income, Taxnet](https://www.taxnet.co.kr/contents/journalweekly/taxtation/taxtation-detail?id=1138&webbookId=1139),
[business income vs other income](https://www.findsemusa.com/service/consult/consultView.do?qidx=21792).

### 3.8 Conversion tracking

- GTM on the checkout and thank-you pages (never on `/my`, and order-status tokens are stripped from the page
  address before any tag runs).
- A standard e-commerce dataLayer (GA4 naming): `view_item` on program pages' buy buttons, `begin_checkout` when
  the checkout opens, `add_payment_info` when a method is chosen, `purchase` on the thank-you page with order
  number, value, currency, VAT, coupon, product and plan. No name, email or phone in the dataLayer.
- **`purchase` fires once per order**: the server marks it as sent; reloading the thank-you page doesn't repeat it.
- **Nothing lost when the browser fails** (the buyer closes the tab on CiderPay's page, an ad blocker, an
  instalment charged a month later): the payment notice is the source of truth, so the admin always has the real
  figure, and the server can also send the purchase to GA4 and Meta directly (Measurement Protocol / Conversions
  API) with the same order number so the two never count twice. This needs the GA4 and Meta credentials in
  Vercel; proposed for the phase after go-live.
- The campaign source (UTM values, click ids, referral code) is captured when the checkout opens and stored on
  the order, so the admin can report sales per campaign whatever the trackers saw.
- A GTM checklist (variables, triggers, the tags to create) is delivered with the checkout.

### 3.9 "내 주문" `/my`

Email → one-time sign-in link (valid 15 minutes, session 30 days). Shows orders and receipts, the instalment
schedule and next charge date, coupons, the private podcast link when enrolled, and the referral block (link,
rewards, cash-or-credit choice). `noindex`, no GTM.

---

## 4. Technical design

Same rules as the rest of the repo: static assets + vanilla JS, API functions on Vercel, Neon Postgres through
`api/_lib/db.js`, no framework, no build step, no new npm dependency.

**Functions** (3 new)

| File | Purpose |
|---|---|
| `api/shop-page.js` | Renders `/checkout/<product>`, `/checkout/complete`, `/my` on the server (header/footer pattern of `podcast-page.js`), so prices and texts are in the HTML itself. |
| `api/shop.js` | The checkout's JSON API: quote (plan + coupon + referral), create order, PayPal create/capture, order status, `/my` sign-in, `/r/<code>`. Same-origin checks and rate limits. |
| `api/shop-callback.js` | CiderPay notices, PayPal webhooks, AC webhooks (coupon generation). Answers fast, handles repeats safely, stores every call raw. |
| `api/admin.js` | Gains the `shop-*` modules; the daily cron gains the shop job. |

Shared code in `api/_lib/shop/`: `pricing.js`, `ledger.js`, `referrals.js`, `coupons.js` (pure, unit-tested),
`orders.js` (state changes), `sync.js` (what each event sends to AC, through `automation.js`'s queue),
`pay/ciderpay.js`, `pay/paypal.js`, `notify.js` (Slack), `copy.ko.js` (every customer-facing string).
Page assets: `site/assets/css/pages/checkout.css`, `site/assets/js/checkout.js`.

**Data model** (migration `005_shop.sql`, tables prefixed `shop_`)

| Table | Holds |
|---|---|
| `shop_products` | slug, name, status, sale window, `price_krw`, `price_usd`, instalment plan, content (JSON), AC tags per event, referral settings, legacy WooCommerce ids |
| `shop_customers` | email (unique), name, phone, address, link to the podcast `students` row by email |
| `shop_orders` | order number, customer, product, currency, plan, amounts (subtotal, discount, credit used, total, VAT), status, coupon, referral, campaign source, status token, origin (site / imported / manual), legacy id |
| `shop_payments` | order, provider, provider references (**unique**), kind, amount, instalment number, receipt URL, refund token, raw payload |
| `shop_ledger` | the permanent tax lines of 3.7 (append-only) |
| `shop_instalments` | order, number, due date, amount, status (due / paid / failed / overdue / cancelled), payment; the plan's `rpToken` sits on the order |
| `shop_coupons` | code, campaign, type, value, products, dates, limits, owner (for individual codes), used by |
| `shop_referrers` | customer, code, status, custom rate, reward preference (cash / credit), payout details |
| `shop_referral_clicks` | code, day, count (no personal data) |
| `shop_rewards` | referrer, order, payment, amount, status (pending / approved / paid / used / cancelled), payout batch |
| `shop_credit` | credit granted and spent per customer |
| `shop_callbacks` | every inbound provider or AC call, verified or not |
| `shop_logins` | hashed one-time `/my` tokens |

- **Order states:** `created → awaiting_payment → paid → refund_requested → refunded / partially_refunded`, or
  `expired`, `cancelled`. Instalment orders are `paid` when the first payment lands, with a plan status
  (`active / overdue / paused / completed / stopped`). State changes go through one function, in a transaction,
  and that function is the only place that writes the ledger and queues AC updates, so the three can't drift apart.
- **Order numbers** start above the highest WooCommerce order id.
- **Secrets** (Vercel env vars; the repo is public): `CIDERPAY_MEMBER_ID`, `CIDERPAY_API_TOKEN`,
  `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`, `SHOP_SECRET` (signs notices, tokens and cookies),
  `SLACK_WEBHOOK_ASHLEY`, `SLACK_WEBHOOK_ALEX`. Previews use PayPal's sandbox and their own database branch.
- **Daily job** (existing cron, 09:10 KST): instalments past their date with no notice, unpaid orders to expire,
  abandoned-checkout tags, referral rewards past the refund window, coupon expiry, AC retries, monthly ledger
  export. On Pro it can run hourly.
- **Protection:** rate limits on order creation and `/my` sign-in, strict validation on the server, personal data
  kept to what an order needs.

---

## 5. Testing (replaces a side-by-side run)

Orders are too rare to compare the old and new checkouts on live traffic, so confidence comes from tests.

**Automated (`npm test`, run on every change)**

- Prices: every product × currency × plan × coupon × referral discount × credit; VAT split to the won.
- Instalment schedules: month ends, the 29th–31st, leap years.
- CiderPay notices replayed from real captured examples: paid, plan agreed / refused, each instalment, failed
  instalment, cancelled; repeated, out of order, with a wrong signature or a wrong amount.
- PayPal: capture, webhook, refund, dispute.
- State changes: each one produces the right ledger lines and the right AC updates (checked together).
- Refund chain: money → order → ledger → AC → podcast revoke → reward cancelled.
- Coupons (single use, expiry, owner), referral rules (self-referral, last link wins), `/my` sign-in tokens.
- Page checks in a browser at 375 / 768 / 1024 / 1440px: form validation, Kakao search, plan switch, no
  horizontal scroll, no console errors.

**Manual, before go-live (a written script, on a preview then on production)**

- A hidden ₩1,000 product (CiderPay's minimum): pay in full → check the order, Slack, AC tags and fields, the
  confirmation email, the tax line, the GTM `purchase` event → refund from the admin → check everything again.
- The same with a ₩1,000 + 2 × ₩1,000 instalment plan with a short interval if CiderPay allows a weekly cycle
  (`periodDateType: WEEK`), to see real second and third charges, the automatic stop, and a forced failure
  (a card that declines).
- PayPal sandbox, then one real small USD payment and refund.
- Phone and desktop, iPhone Safari and Android Chrome, KakaoTalk's and Instagram's in-app browsers (where most
  of Ashley's traffic arrives).
- The CiderPay check report against CiderPay's dashboard for those test payments.

---

## 6. Migration and cutover

A payment link is just an address on a sales page: each product moves to the new checkout by changing its
link, and can move back the same way if something is wrong.

1. **Inventory.** Export from WordPress: products, coupons, orders (with instalment parents and children and
   their payment details), customers; the list of active plugins and the "Integration" tab (what tags AC
   today); the instalment plans still running and when each ends.
2. **Build on a branch**, tested as in section 5.
3. **Go live** (Vercel Pro from here): all payment links switch to the new checkout in a quiet period, outside a
   launch. WordPress stays up, untouched, as the fallback.
4. **Import history** into orders, customers and the ledger (marked `imported`); referral links created for past
   customers.
5. **Instalments already running on WooCommerce.** CiderPay keeps sending their notices to
   `ashleylim.com/wp-json/ciderpay/v1/confirmation` until they end. WordPress stays up until the last one
   finishes, or, once ashleylim.com points to Vercel, that exact address is routed to `api/shop-callback.js`,
   which recognises the old order numbers from the import.
6. **Redirects.** `/?product=<old id>&currency=…&plan=…` → the matching new checkout; `/checkout`, `/cart`,
   `/my-account`, `/product/*`, `/shop` → new pages or home. `tools/rebuild/sitelinks.py` and the page links
   switch from `https://ashleylim.com/?product=…` to `/checkout/<product>`.
7. **Later, once everything is confirmed working: the bare domain.** ashleylim.com (no www) moves to Vercel and
   becomes the only address; www redirects to it. This reverses the current "www is canonical" setup: canonical
   links, sitemap, podcast links (`PODCAST_PUBLIC_URL`), the callback addresses registered at CiderPay, PayPal
   and AC, and CLAUDE.md all change in one pass. Student podcast feeds on www keep working through the redirect.
8. **Retire WordPress.** Full backup (database + uploads) kept offline; hosting cancelled after the last
   WooCommerce instalment and a quiet month.

---

## 7. Checklist for Ashley / Alex (outside the code)

- [ ] WordPress: export orders, customers, products, coupons; list active plugins; note what adds AC tags on purchase.
- [ ] PayPal: create a REST app (client id + secret), sandbox accounts, webhook.
- [ ] ActiveCampaign: create the contact fields of 3.4; build the automations (confirmation, instalment
      reminder, failed instalment, refund, coupon, referral) on the tags of 3.4; add the coupon webhook step
      where a sequence should hand out a code.
- [ ] GTM: create the tags from the checklist delivered with the checkout.
- [ ] Vercel: add the env vars from section 4; move to Pro at go-live.
- [ ] Texts from Ashley: consent line, guarantee line, thank-you page, AC emails, privacy policy update
      (checkout data, CiderPay, PayPal, Neon, ActiveCampaign); referral terms later (R6).
- [ ] The refund window is 14 days: the live WordPress NSMB page still says "7일 환불 보장" under its last button (this site's `/nsmb` and `/engine` say 14일).

---

## 8. Still open

| # | Question | For | Blocks |
|---|---|---|---|
| O1 | Confirm the tax findings of 3.7: USD / PayPal sales taxable at 10%? Which exchange rate and date? | Accountant | Phase 4 (reports); the default is in place |
| O2 | Cash referral rewards: 22% other income or 3.3% business income, the ₩50,000 threshold, and how Ashley collects the identification needed for the payment statement. How to show credit and discounts. | Accountant | Phase 6 |
| O3 | Does CiderPay retry a failed monthly charge by itself, and can a plan run weekly for testing (`WEEK` is in the documentation)? | CiderPay support, or the first test | Phase 3 testing |
| O4 | Check in the PayPal dashboard whether "Pay Later" messaging is offered to this (Korean) account. If it is, the banner can be added next to our own line. | Alex | Nothing |

Answered on 2026-11-10: PayPal account country (Korea), today's AC tags (`purchased_…`, from the AC plugin),
record retention (keep everything), refund window (14 days), CiderPay failures (they can be silent: handled by
the daily schedule check).

## 9. What this won't do

- **The card step still happens on CiderPay's page** (D1).
- **No physical goods**: no shipping, stock or delivery. If Ashley ever sells a book, that's new work.
- **No tax advice**: the admin records and reports; the accountant decides how figures are declared.

---

## 10. Phase 2 as built (2026-11-11)

**What exists**

| Piece | Where |
|---|---|
| Checkout page `/checkout/<product>` and thank-you page `/checkout/complete` | `api/shop-page.js`, rendered by `api/_lib/shop/page.js`; styles `site/assets/css/pages/checkout.css`; browser script `site/assets/js/checkout.js` |
| Order API (create order, payment status, "purchase event sent") | `api/shop.js` |
| Provider notices (CiderPay feedback, PayPal webhooks) | `api/shop-callback.js` |
| Rules | `api/_lib/shop/`: `config.js` (secrets, signatures, addresses), `validate.js` (the form), `orders.js` (orders, recording a payment), `flow.js` (start, confirm), `pay/ciderpay.js`, `pay/paypal.js`, `sync.js` (ActiveCampaign queue), `notify.js` (Slack), `copy.ko.js` (every Korean text) |
| Database | `db/migrations/006_shop_checkout.sql`: provider columns on orders, `shop_callbacks` (every notice received), `shop_outbox` (ActiveCampaign queue) |
| Admin | Orders show payments, tax lines, ActiveCampaign updates and provider notices; Overview lists what needs attention; Settings shows which keys this deployment has |

**How a payment is confirmed**

- The browser sends only the product, the currency and the buyer's details. Amounts come from the product.
- CiderPay: the request carries the order's token and our signature (of token + order number + amount). A notice is
  accepted only with the secret key in its address, that token, that signature, our merchant id and exactly the
  expected amount. Anything else is refused, logged, and a Slack alert goes out.
- PayPal: the buyer approves on PayPal and comes back; our server captures the payment and checks the amount and
  currency in PayPal's answer. If the buyer never comes back, PayPal's webhook triggers the same capture. Webhooks
  are checked with PayPal before anything is believed.
- A payment is recorded once (unique provider reference), together with its tax ledger line and the order's
  state, in one database statement. A repeated notice changes nothing.
- A valid payment for an expired order is accepted. A second, different payment for an order that is already
  paid is **held, not recorded**: it is kept with its full notice in `shop_callbacks` (outcome `extra`) and a Slack
  alert goes out. If it is real, refund it at the provider. Recording it would write a permanent tax line, and a
  replayed notice could then inflate the reported sales. Only two payments arriving at the very same instant are
  both recorded (and flagged).
- A paid buyer never silently misses their ActiveCampaign tags: a provider's repeated notice queues them again, the
  daily job queues them for any paid order that has none, the admin Overview counts such orders, and "Send to
  ActiveCampaign now" on the order queues and sends them.

**The page (redesigned 2026-11-11 after Alex's review: ThriveCart / ClickFunnels order form, not WooCommerce)**

- The site's own header and footer (`header.css`, `footer.css`), like every other page.
- The product is the headline (name, summary, price), with a "안전 결제" badge above it.
- One form card with three numbered steps (내 정보, 주소, 결제 방법), then the order and its total, then one large
  button with the amount (`₩2,690,000 결제하기 →`; PayPal's yellow for USD).
- Beside the form (below it on phones): the product image and "포함 내용", the guarantee in a green box, reviews.
  Each comes from the product in the admin (Image, What's included, Guarantee, Reviews) and is left out when empty.
- Structural labels added for the design: "안전 결제", "포함 내용", "후기", "주문 요약", "총 결제 금액", the step names.

**Differences from the plan above**

- **PayPal has no button on our page.** The buyer is redirected to PayPal and back (one flow, works without
  JavaScript, one fewer outside script).
- **Instalment plans are not sold yet** (phase 3). A product's plan is stored but the checkout only offers pay in
  full; `?plan=instalment` is ignored.
- **No sticky pay button on phones**: the form is short and a fixed bar collides with the keyboard.
- **Not yet on the checkout**: testimonials, coupons, order bump, abandoned-checkout tags (later phases).
- **Refunds and cancellations** made at the provider are logged and raise a Slack alert, but the order must be
  updated by hand until phase 3.
- **Vercel previews**: providers can only reach a preview through Vercel's "Protection Bypass for Automation".

**How it is tested**

- `npm test`: unit tests of every rule (prices, VAT, signatures, the form, provider answers, pages, ActiveCampaign
  sending, Slack), no network.
- `npm run test:shop`: end-to-end. The real endpoints and database statements against fake CiderPay and PayPal
  (`tools/shop/`), inside a transaction that is rolled back. It plays paying, paying twice, forged notices, wrong
  amounts, cancelling, declined cards, never returning, late payments, rate limits, and checks the order, the
  payment, the tax line and the ActiveCampaign queue after each.
- The `shop-admin` preview runs the same thing in a browser: `/checkout/<product>` leads to a fake payment page
  with a button for each case.
- **Not testable without Alex**: a real CiderPay payment (no test mode exists) and a PayPal sandbox payment.
- **Independent review: done 2026-11-13** (a separate reviewer attacking the deployed code; no PayPal path lets an
  outsider mark an order paid). Fixed after it:
  - a paid buyer could end up with no ActiveCampaign tags and nobody told (see above);
  - a second payment for a paid order wrote a permanent tax line, so a replayed notice could inflate sales (now held);
  - production honoured `PAYPAL_ENV=sandbox` (now always live there);
  - on Vercel the request body was re-serialised before PayPal's signature check (now the exact text is read first);
  - a CiderPay notice without our merchant id was accepted (now refused); a repeated form field keeps its first value;
  - the thank-you page refused a return by form POST and broke on junk after the token (both handled);
  - PayPal holding a payment, the same buyer paying twice for one product, and refused CiderPay notices that reached
    our secret address now send a Slack alert;
  - anyone could block a buyer by typing their email 10 times (the per-email limit is gone; per-network stays);
  - a preview without its own database could write into production's tables (the shop now refuses there);
  - USD or KRW was offered even without that provider's keys (now only what this deployment can take);
  - ActiveCampaign calls could hang a payment notice (20-second limit, shorter budget in the notice).
  An earlier pass by the author had fixed broken request bodies, rate limits too tight for shared mobile networks,
  two racing payments not flagged, and strangers able to add rows to the notice log.
- **Still open from the review** (need the real CiderPay to answer):
  - CiderPay's authenticity rests on the secret key in our notice address staying secret. During the first real
    payment (step 6), check the CiderPay page does not show our address: see step 6.
  - CiderPay's `taxPrice` (taxable amount) is not sent yet; their VAT document may then disagree with our ledger.
    Ask CiderPay whether it must be sent, and whether it includes VAT.
  - Minor, accepted for now: the "purchase sent to GTM" flag is set even if an ad blocker stopped GTM; the secret key
    sits in Vercel's request logs (only visible to the Vercel account).
- **WordPress, urgent and separate:** Kakao closes `t1.daumcdn.net` on 2026-11-30. The WordPress snippet "Add Kakao
  postcode button…" loads the address search from there: change that address to `t1.kakaocdn.net` in the snippet
  before that date, or the "우편번호 찾기" button on the current checkout stops working.

**Alex's tests before go-live** (in order; each needs the previous one)

1. Vercel → Project → Settings → Environment Variables, for **Preview**: `SHOP_SECRET` (any random text of 32+
   characters), `CIDERPAY_MEMBER_ID`, `CIDERPAY_API_TOKEN` (the two values from WooCommerce → Payments → CiderPay),
   `SLACK_WEBHOOK_ALEX` (optional).
2. Vercel → Project → Settings → Deployment Protection → **Protection Bypass for Automation** → enable. Redeploy
   the `shop` preview.
3. `npm run db:migrate:preview` (adds migration `006` to the preview database).
4. On the preview: `/admin/shop/settings` must show "ready" for the shop secret, CiderPay and the preview line.
5. `/admin/shop/products`: create a product "Test", address `test`, status Open, KRW price `1000`, purchase tag
   `test_shop_purchase`.
6. Open `/checkout/test` on a phone, pay ₩1,000 with a real card. Expected: back on the thank-you page within
   seconds; Slack message starting with `[TEST]`; in the admin the order is Paid with one payment, one tax line
   (₩909 + ₩91) and a notice "paid"; in ActiveCampaign the contact has the tag `test_shop_purchase`.
   **Also, on a computer before paying:** on CiderPay's payment page, right-click → View page source, and search
   (Cmd+F) for `shop-callback` and for `k=`. Neither should appear. If either does, stop and tell Claude: the notice
   address would then be visible to buyers, and the CiderPay check must be changed before real sales.
7. Refund the ₩1,000 in CiderPay's dashboard. Expected: a Slack alert that CiderPay reports a cancellation (the
   order itself stays Paid until phase 3).
8. PayPal: create a REST app at developer.paypal.com (sandbox), add `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` for
   Preview; create a webhook to the address shown in `/admin/shop/settings` (events: Checkout order approved,
   Payment capture completed/refunded/denied), add its id as `PAYPAL_WEBHOOK_ID`; redeploy. Give the Test product
   a USD price, open `/checkout/test?currency=usd`, pay with a sandbox buyer account.
9. Tell Claude what happened at each step, especially anything unexpected on CiderPay's page (step 6 is the first
   time the new request format meets the real CiderPay).
