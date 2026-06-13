# The Thomas Hotel — Voice Receptionist Middleware

A stateless, production-grade HTTPS middleware that sits between a Retell AI voice agent ("Ava") and the Guesty property-management API + Twilio SMS API for **The Thomas Hotel**, an 8-room boutique hotel at 109 E Erwin St, Tyler, TX 75702. The middleware qualifies bookings, checks availability, quotes prices, and texts guests a pre-filled booking link. Built with Node.js, TypeScript, and Express.

## Quickstart

```bash
cp .env.example .env
# Fill in all required values in .env
npm install
npm run dev
```

## Scripts

| Script         | Command            | Description                          |
| -------------- | ------------------ | ------------------------------------ |
| `dev`          | `npm run dev`      | Start dev server with hot reload     |
| `build`        | `npm run build`    | Compile TypeScript to `dist/`        |
| `start`        | `npm start`        | Run compiled JS from `dist/`         |
| `test`         | `npm test`         | Run all unit + integration tests     |
| `lint`         | `npm run lint`     | ESLint check                         |
| `format`       | `npm run format`   | Prettier format                      |

## Endpoint Reference

| Method | Path                   | Auth | Description                                              |
| ------ | ---------------------- | ---- | -------------------------------------------------------- |
| GET    | `/health`              | No   | Health check — returns status, version, uptime           |
| POST   | `/check_availability`  | Yes  | Check suite availability for date range + guest count    |
| POST   | `/get_quote`           | Yes  | Get a price quote for a specific suite + dates           |
| POST   | `/send_booking_link`   | Yes  | Send SMS with pre-filled booking link to guest           |
| POST   | `/lookup_reservation`  | Yes  | (v2, feature-flagged) Look up existing reservation       |
| POST   | `/post_call`           | Yes  | (v2, feature-flagged) Receive post-call webhook from Retell |

### POST /check_availability

**Request:**
```json
{
  "call": { "call_id": "abc", "from_number": "+1..." },
  "args": {
    "check_in_date": "2026-07-04",
    "check_out_date": "2026-07-06",
    "number_of_guests": 2
  }
}
```

**Response (success):**
```json
{
  "available": true,
  "suites": [
    { "name": "Garden Suite", "nightly": 380 },
    { "name": "Premium Suite", "nightly": 295 }
  ]
}
```

**Response (none available):** `{ "available": false, "suites": [] }`
**Response (error):** `{ "error": true }`

### POST /get_quote

**Request:**
```json
{
  "args": {
    "suite_name": "Garden Suite",
    "check_in_date": "2026-07-04",
    "check_out_date": "2026-07-06",
    "number_of_guests": 2
  }
}
```

**Response (success):**
```json
{
  "quote_id": "q_8sd9f7",
  "suite": "Garden Suite",
  "nightly": 380,
  "nights": 2,
  "cleaning": 75,
  "taxes": 61,
  "total": 896
}
```

**Response (error):** `{ "error": true }`

### POST /send_booking_link

**Request:**
```json
{
  "args": {
    "suite_name": "Garden Suite",
    "check_in_date": "2026-07-04",
    "check_out_date": "2026-07-06",
    "number_of_guests": 2,
    "phone_number": "+19035551234",
    "guest_name": "Jane Doe"
  }
}
```

`guest_name` is optional (defaults to `"Guest"`) and is only used by the Guesty SMS
path to name a newly created guest/inquiry.

**Response (success):** `{ "sent": true }`
**Response (failure):** `{ "sent": false }`

#### SMS delivery: Twilio (default) vs Guesty (`ENABLE_GUESTY_SMS`)

By default the booking link is sent via **Twilio** from `TWILIO_FROM`. Set
`ENABLE_GUESTY_SMS=true` to instead send it **through Guesty** so the message is sent from the
Guesty-provisioned number and threads into the guest's conversation in the **Guesty Unified
Inbox** (visible in the dashboard). Requires the Guesty SMS add-on + a provisioned number on the
account and `GUESTY_OAPI_*` credentials.

How the Guesty path resolves a conversation to send into:
1. **Existing/returning guest** — find the guest by phone, then their conversation, and send. Fast.
2. **New prospect** — create a guest (if none) + an `inquiry` reservation so Guesty spawns a
   conversation, briefly poll for it, then send.

Caveats:
- A freshly created inquiry's conversation may not be queryable instantly (Guesty advises up to
  ~60s between reservation mutations). The poll is bounded; if the conversation can't be confirmed
  the route returns `{ "sent": false }` while the guest + inquiry remain in Guesty for follow-up.
  This new-prospect path can exceed the ~1.5s response budget — have the agent say
  "you'll get the text shortly."
- Each new-prospect send creates an `inquiry` lead (no blocked dates); if the guest later completes
  the booking via the link, a separate reservation exists. Dedupe by guest in the dashboard.

## Deployment Notes

- **Stateless service** — no database, no local file writes. Can run on Render, Railway, Fly.io, or AWS ECS/Lambda.
- **Single-instance token cache** — the Guesty OAuth token cache is in-memory. For multi-instance deployments, swap to Redis: store `{ accessToken, expiresAt }` keyed by API type, with a distributed lock (e.g., Redlock) to prevent thundering herd on token refresh.
- All env vars must be set via your platform's secrets/env management.
- HTTPS termination should be handled by your platform or a reverse proxy — the Express server itself listens on HTTP.

## Security Checklist

- [x] Secrets in env vars / secrets manager, not in code
- [ ] HTTPS only in production (via platform/reverse proxy)
- [x] Retell shared-secret verified on every endpoint (except `/health`)
- [x] 429 backoff and 401 refresh tested
- [x] All handlers return clean JSON on failure, never throw 500
- [x] Response time budget < 1.5s (6s per-Guesty-request timeout, aggressive backoff)
- [x] Twilio `from` is a real number; SMS body never leaks internal data
- [x] No card data collected, stored, or logged anywhere

## Pre-Launch Checklist

Before going live, verify each item:

- [ ] Bracketed prompt lines in Retell replaced with real check-in/out times, parking, pet policy, cancellation terms
- [ ] `LISTING_MAP` verified against the live booking site; every suite resolves correctly
- [ ] Deep-link template tested — link opens the right suite, dates, and guest count on the real booking site
- [ ] Booking Engine instance confirmed to allow self-serve payment on the hosted page (instant booking + connected processor)
- [ ] Token caching verified for both APIs (Booking Engine + Open API)
- [x] If `ENABLE_GUESTY_SMS=true`: Guesty SMS path smoke-tested live against the account — guest/inquiry/conversation/`send-message` shapes confirmed; SMS delivered from the Guesty number and threaded in the inbox (re-run end-to-end through the deployed server, where outbound `fetch` works)
- [ ] 429 backoff + error-fallback confirmed in staging
- [ ] Retell request auth enforced on every endpoint
- [ ] All unit + integration tests pass (`npm test`)
- [ ] `.env` filled with real credentials, not placeholders

## Known TODOs

Every `// TODO` in the codebase marks a value that must be verified against the live Guesty account or booking site:

| File | TODO |
| ---- | ---- |
| `src/guesty/tokenCache.ts` | Verify OAuth content-type (form-encoded vs JSON) for your Guesty account |
| `src/guesty/bookingEngine.ts` | Verify exact Booking Engine availability search endpoint path |
| `src/guesty/bookingEngine.ts` | Verify exact Booking Engine quote endpoint path |
| `src/guesty/openApi.ts` | Verify exact Open API reservations endpoint path (v2) |
| `src/shapers/quote.ts` | Verify field paths against live Guesty quote payload |
| `src/shapers/availability.ts` | Verify field paths against live Guesty availability response |
| `src/shapers/reservation.ts` | Verify field paths against live Guesty reservations response (v2) |
| `src/links/bookingLink.ts` | Verify deep-link query-parameter names (`checkIn`, `checkOut`, `minOccupancy`) against real booking site URL |
| `src/auth/retellAuth.ts` | Upgrade from shared-secret to full HMAC signature verification when Retell supports it |











Claude Latest ouput: 

Everything passes — lint, build, 54 tests. Here's the summary of what changed in the agent
  JSON:

  Removed 7 tools (not in our middleware spec):
  - get_room_details — no endpoint for this
  - search_booking — v2 feature, not active
  - modify_booking — not in spec (v3+)
  - cancel_booking — not in spec (transfers to front desk per prompt)
  - get_hotel_info — not in spec (knowledge is in the prompt)
  - create_booking_quote — replaced by get_quote
  - confirm_booking — old flow, not needed

  Kept 2 built-in tools:
  - end_call — unchanged
  - transfer_call — fixed the phone number spacing (removed leading space)

  Updated/added 3 custom tools, all pointing to ngrok:

  ┌────────────────────┬──────────────────────────┬───────────────────────────────────────┐
  │        Tool        │           URL            │              Key changes              │
  ├────────────────────┼──────────────────────────┼───────────────────────────────────────┤
  │ check_availability │ ngrok/check_availability │ Added x-retell-secret header, updated │
  │                    │                          │  description                          │
  ├────────────────────┼──────────────────────────┼───────────────────────────────────────┤
  │ get_quote (NEW)    │ ngrok/get_quote          │ Takes suite_name + dates + guests,    │
  │                    │                          │ returns 7 price fields                │
  ├────────────────────┼──────────────────────────┼───────────────────────────────────────┤
  │        Tool        │           URL            │                                       Key changes                                        │
  ├────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
  │ check_availability │ ngrok/check_availability │ Added x-retell-secret header, updated description                                        │
  ├────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
  │ get_quote (NEW)    │ ngrok/get_quote          │ Takes suite_name + dates + guests, returns 7 price fields                                │
  Kept 2 built-in tools:
  - end_call — unchanged
  - transfer_call — fixed the phone number spacing (removed leading space)

  Updated/added 3 custom tools, all pointing to ngrok:

  ┌────────────────────┬──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────┐
  │ get_quote (NEW)    │ ngrok/get_quote          │ Takes suite_name + dates + guests, returns 7 price fields                                │
  ├────────────────────┼──────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
  │ send_booking_link  │ ngrok/send_booking_link  │ Completely new params: suite_name, dates, phone_number instead of old quote/guest fields │
  └────────────────────┴──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────┘

  Middleware updates:
  - All routes now accept both { args: {...} } (wrapped) and root-level args ({ check_in_date: ... }) via extractArgs utility
  - number_of_guests coerced from string (Retell sends strings) via z.coerce.number()

✻ Churned for 5m 1s · 1 shell still running

※ recap: Building the Thomas Hotel voice receptionist middleware between Retell AI and Guesty/Twilio. Just finished updating the agent JSON to match our 3 endpoints and
  fixing routes for Retell's format. All 54 tests pass. Ready to test live via ngrok. (disable recaps in /config)
