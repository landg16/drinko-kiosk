# Drinko Bar Kiosk — Product & Development Plan

Draft v2 · 20 September 2026 · Hardware protocol details live in [HARDWARE_PROTOCOL.md](./HARDWARE_PROTOCOL.md).
v2 folds in the decisions taken on 20 Sep (§8).

## 1. What we are building

Drinko is a self-service cocktail kiosk for a bar. A guest walks up to a **portrait touch screen**,
picks drinks, pays, places a cup, and the machine pours. The machine has **4 liquid channels**
(tank + pump + flow sensor + valve each) in an integrated fridge, and talks to a Linux mini-PC over
USB serial. Cups are stacked beside the kiosk; a cup dispenser may come later.

Software has two parts, both running on the kiosk PC:

- **Server (Node + TypeScript)** — owns the USB device, keeps menu/inventory/orders, exposes a local
  HTTP API and a realtime event stream, and later talks to the payment provider.
- **Client (React + TypeScript)** — the touch UI, running full-screen in a kiosk-mode browser and
  talking only to `localhost`.

### Goals for v1

- A guest with no instructions orders and pays in **under 60 seconds**.
- Zero staff involvement on the happy path; calm, specific messaging when something fails.
- Hardware safety: never pour an unpaid order, never double-pour, never leave a pump running.
- Bar staff can refill, rinse, calibrate and change prices from the screen, without a developer.
- Works fully offline except for the (future) payment step.

### Non-goals for v1

Real payment integration (mocked with a card-tap animation until a provider is chosen), multiple
machines, cloud dashboard, loyalty, ID scanning, receipt printing. The architecture leaves room for
them but nothing is built.

## 2. Where we are today (repo audit)

The repo is a pnpm workspace with `client` and `server`.

**Client** — Vite 7, React 19, TypeScript, Tailwind v4, shadcn/ui (new-york, zinc), zustand,
TanStack Query (provider mounted, unused), React Router 7, lucide icons. A working *visual*
prototype exists: Welcome → Menu (category rail + drink grid + bottom basket bar) → Payment
(summary, simulated card tap / QR) → Pouring (simulated progress) → Completion. A drink modal picks
Regular/Double quantities, an inactivity timer resets after 60 s, a cancel confirmation exists.
It is laid out for landscape; the kiosk is portrait (§6).

**Server** — rebuilt on 20 Sep against the mock device: config loader, device controller with
queue, timeouts and reconnect, mock and serial transports, order state machine, mock payment,
SQLite persistence, REST + SSE API, admin and dev endpoints, and a vitest suite. See `server/README.md`.

Everything customer-facing is mocked: drinks are hard-coded, payment succeeds at random 80 %,
pouring is a timer. That was the right way to explore the UI; now it needs a real backbone.
Concrete things the refactor must fix:

| Problem | Where | Fix |
| --- | --- | --- |
| Layout assumes landscape (30/70 split, 2-column grid in the wide pane) | menu, checkout | Portrait layout (§6.2) |
| Double price (`price * 1.8`) is computed in 7 places | menu, basket, payment, drink-modal | Prices come from the server per size; client never computes |
| Cart items removed by array index | `general-store.ts`, menu, basket, payment | Remove by `cartId`; drop `any` in the grouped-cart reducer |
| `BasketPage` is routed but nothing navigates to it | `router.tsx`, `basket-page.tsx` | Delete; the menu's basket bar + checkout summary cover it |
| Drink images are hot-linked from Unsplash | `data/drinks.ts` | Bundle local assets; the kiosk may have no internet |
| Colors are hard-coded Tailwind classes (`purple-600`, `zinc-900`, …) everywhere | all pages | Design tokens (§6.4) mapped into Tailwind `@theme` |
| `hover:` styles on a touch screen | all pages | Use `active:` only |
| Legacy `tailwind.config.ts` is not loaded by Tailwind v4 (no `@config`) | client root | Delete; `font-noto` never applied anyway |
| Both `react-router` and `react-router-dom` installed | `client/package.json` | Keep one (`react-router`) |
| Currency shown as `$` | all pages | GEL (`₾`), formatted by one helper |
| Max 10 of one drink per order | `drink-modal.tsx` | Max 4 drinks per order total (one cup at a time, §5.7) |
| QR payment view and random decline | `payment-page.tsx` | One "Pay" button → card-tap animation → success (§6.2 step 7) |
| Inactivity timer resets only on `click`/`touchstart` | `inactivity-timer.tsx` | Also `pointerdown`/`keydown`; show a 10 s warning before reset |
| `.DS_Store` staged | repo root | Add to `.gitignore`, unstage |
| No shared types between client and server | — | `packages/shared` (§4.4) |
| No tests, no CI, no README | — | Vitest in both packages, GitHub Actions for lint + test |

## 3. Hardware in one page

Full detail in [HARDWARE_PROTOCOL.md](./HARDWARE_PROTOCOL.md). What matters for the software design:

- USB → UART, 115200 baud. JSON messages `{ Status, CommandType, Payload[4] }` in both directions.
- Commands: `PourCap`, `PourWithoutCap`, `CheckTank`, `Rising` (rinsing), `StopWorking`.
- A pour request carries **grams per channel** (values above 255 are fine); all requested pumps run
  **at the same time**. The firmware on the desk acknowledges a pour immediately by echoing it,
  answers BUSY to everything until the pour ends, and sends **no result message**. There is no
  progress feedback; the server polls CheckTank to detect the end.
- One command in flight at a time; anything else gets `DeviceBUSY`. Only `StopWorking` may interrupt.
- Errors: tank empty, no cup (dispenser only), flow meter error, hardware error. Tank check returns OK/Low per channel.
- **No cup dispenser and no cup sensor in v1.** Guests place their own cup; `PourWithoutCap` does not
  check for one. A cup sensor is possible and has been requested.
- The doc is from May 2024, contains stale examples and leaves timing and error semantics
  undefined. The probe confirmed baud rate and framing on 20 Sep (the device pretty-prints replies
  with no terminator, so the driver frames by brace matching). CheckTank currently answers all
  zeros, which needs the developer's explanation. Flow rate still needs a test pour.

Design consequences:

1. The server needs a **command queue with timeouts** and a **reconnect loop**.
2. Pour progress is **estimated from calibrated flow rate** (the slowest channel sets the time);
   the bar fills to ~95 % and snaps to 100 % when the device goes idle again.
3. Because the guest places the cup, every drink starts with an explicit **"Place your cup, then
   tap Pour"** step. A cup sensor later turns that into zero taps.
4. Tank status feeds **availability**: a drink whose ingredient channel is low is hidden *before*
   payment, not failed after.

## 4. Target architecture

### 4.1 Deployment shape

```
┌──────────────── Kiosk PC (Linux mini-PC) ───────────────────────────────┐
│                                                                         │
│  Chromium --kiosk http://localhost:8000      Node server (systemd)      │
│  ┌──────────────────────────┐   HTTP + SSE   ┌────────────────────┐     │
│  │ React client (built,     │ ◄────────────► │ Express API        │     │
│  │ served by the server)    │                │ Domain (orders,    │     │
│  └──────────────────────────┘                │  catalog, pours)   │     │
│                                              │ Hardware driver ───┼─────┼─► /dev/drinko (USB/UART) ─► device
│                                              │ Payment adapter ───┼─────┼─► Internet (later)
│                                              │ SQLite             │     │
│                                              └────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

- **One process, one port.** In production the server serves the built client from `client/dist`,
  so there is no CORS and no second service. In development Vite proxies `/api` to the server.
- **Chromium kiosk mode** rather than Electron: simpler to build and update, and the OS already
  provides auto-login and auto-start.
- **Linux specifics**: systemd unit with `Restart=always`, a udev rule that names the device
  `/dev/drinko`, Chromium started from the desktop session's autostart. The server has no native
  build step: SQLite comes from Node's built-in `node:sqlite`, and `serialport` ships prebuilt binaries.
- **Development on Windows** uses `COM4`-style paths; the driver reads the path from config.

### 4.2 Server layers

```
server/src/
  index.ts                 bootstrap: config → db → hardware → http
  config/                  zod schema + loader for channels, drinks, prices, timeouts, PIN
  hardware/
    driver.ts              DeviceDriver interface: the seam between the kiosk and any board
    device-controller.ts   board-agnostic: one command at a time, timeouts, reconnect, tank polling, status
    registry.ts            HARDWARE name → driver; add a case here for a new board
    drinko-json/           the current board: protocol codec, framing, serial + mock transports, driver
  domain/
    catalog.ts             ingredients, recipes, drinks, sizes, pricing
    availability.ts        tank status → which drinks are orderable
    pour-planner.ts        order item → grams[4] (ml × density × calibration)
    orders.ts              order state machine + persistence
  payment/
    adapter.ts             interface; mock.ts now (card-tap animation), real provider later
  api/
    http.ts                REST routes (menu, orders, device, admin)
    events.ts              SSE hub (device.status, order.updated, pour.*)
  db/                      SQLite (node:sqlite), schema, repositories
  scripts/
    probe-device.ts        serial probe (exists)
```

Libraries: `serialport`, `zod`, `pino`, Node's built-in `node:sqlite`, `vitest`; the serial driver is
tested against serialport's own mock port.

### 4.3 Order lifecycle (server-owned state machine)

```
draft ──pay──► paying ──ok──► paid ──► awaiting_cup(1) ──guest taps Pour──► pouring(1) ──ok──► served(1)
                 │                         ▲                                   │                 │
                 └──declined──► draft      └──────────── next item ────────────┼─────────────────┘
                                                                               └──fail──► failed_partial
                                                                     … last item served ──► completed
```

- Every transition is persisted, so a power cut mid-order leaves a record staff can act on.
- Per item: guest places a cup and taps Pour → `CheckTank` for the item's channels → `PourWithoutCap`
  with the planned grams → map the per-channel status to a domain result → `pour.done` or
  `pour.failed`. The next item's "Place your cup" screen doubles as "take your drink".
- A failed item never blocks the machine: `StopWorking`, mark device state, show the staff screen.
- With a cup sensor later, `awaiting_cup` resolves on the sensor instead of a tap.

### 4.4 Shared package

`packages/shared` (added to `pnpm-workspace.yaml`) holds the API types, protocol enums, zod
schemas and the i18n key type. Client and server import it; there is one source of truth for
`Drink`, `Order`, `DeviceStatus`, `PourResult`.

### 4.5 API sketch

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Liveness for the watchdog |
| `GET /api/menu` | Categories, drinks with sizes, prices, availability, currency |
| `GET /api/device/status` | `connected`, `state` (idle / pouring / error), tanks[4], last error |
| `POST /api/orders` | Create order from cart items; server recomputes total |
| `POST /api/orders/:id/pay` | Mock now: returns success after the animation delay; real adapter later |
| `POST /api/orders/:id/pour` | Guest confirmed the cup is placed; server pours the next item |
| `POST /api/orders/:id/cancel` | Only before payment |
| `POST /api/device/stop` | Emergency stop (also on the staff screen) |
| `GET /api/events` | SSE stream: `device.status`, `order.updated`, `pour.started { expectedMs }`, `pour.done`, `pour.failed` |
| `GET/PUT /api/admin/*` (PIN header) | Tank check, rinse, prime, test pour, calibration, prices, enable/disable drinks, sales, logs |

SSE (`EventSource`) rather than WebSocket: the client only needs server → client pushes, and
`EventSource` reconnects on its own.

### 4.6 Client structure

```
client/src/
  app/            router, providers, error boundary → "Out of service" fallback
  features/
    attract/      welcome screen with 18+ notice
    menu/         category chips, drink grid, drink sheet
    cart/         store (zustand), basket bar
    checkout/     summary, pay button, card-tap animation
    pouring/      place-cup, pouring, done
    admin/        PIN pad, dashboard
  components/
    ui/           shadcn primitives
    kiosk/        Screen, PrimaryButton, Stepper, SegmentedControl, Countdown, StatusBanner
  lib/            api client (typed by packages/shared), useEvents (SSE), i18n, format (₾)
  styles/         tokens.css (design tokens → Tailwind @theme)
  assets/         fonts (Noto Sans Georgian, bundled), drink illustrations
```

Kiosk hardening: disable context menu, text selection, pinch zoom and overscroll; no scrollbars;
error boundary that shows a friendly screen and reloads after 5 s; all assets local.

## 5. Menu and cocktail recommendations

Decided: **layout A** (Vodka, Gin, Tonic, Energy drink). The alternatives stay here for reference
in case the fizz test fails.

### 5.1 Constraints that shape the menu

| Constraint | Consequence |
| --- | --- |
| 4 channels total | Exactly 4 liquids in the machine. Every drink is a combination of them |
| Pumps only: no ice, no shaking, no muddling, no garnish | Only "build" drinks: pour A, pour B, serve. Two-ingredient highballs are the sweet spot |
| Carbonated liquids through a pump lose CO₂ and foam | Tonic and energy drink are at risk. **Bench test before finalizing** (§5.5) |
| Viscous liquids pump badly and are hard to clean | No cream liqueurs, no thick syrups, no coconut cream |
| Perishables | Juices spoil in a day; spirits and canned mixers are shelf-stable |
| Temperature | The integrated fridge matters for taste, fizz retention and foam (see §5.8) |
| Guest places the cup | Recipes fit a 250 ml cup with headroom; shots use small cups (§5.4) |

### 5.2 Channel layouts considered

| Layout | Channels | Menu you get | Pros | Cons |
| --- | --- | --- | --- | --- |
| **A. Club** (chosen) | Vodka, Gin, Tonic, Energy drink | Gin & Tonic, Vodka Tonic, Vodka Energy, Gin Energy, Vodka shot, Gin shot, Tonic, Energy | Highest demand in bars/clubs; all shelf-stable; matches the current UI | Two carbonated mixers; Gin Energy is a filler |
| B. Classic | Vodka, Whiskey, Cola, Tonic | Whiskey & Cola, Vodka & Cola, Vodka Tonic, shots, Cola, Tonic | Universally known; shelf-stable | Two carbonated; cola is sticky and stains lines |
| C. Juice bar (pump-safe) | Vodka, Gin, Orange juice, Cranberry juice | Screwdriver, Vodka Cranberry, Madras, Gin & Juice, Gin Cranberry, shots, juices | No fizz problem, no foaming | Juices need daily replacement; less "night" energy |
| D. Georgian twist | Chacha, Vodka, Tarragon lemonade, Tonic | Chacha & Tarkhuna, Vodka Tarkhuna, Vodka Tonic, Chacha Tonic, shots | Local identity, tourist appeal | Two carbonated; chacha divides opinion |

Fallback if tonic or energy drink come out flat: swap the weaker of the two for cranberry juice
(A′: Vodka, Gin, Tonic, Cranberry → Gin & Tonic, Vodka Tonic, Vodka Cranberry, Gin Cranberry).

### 5.3 Recipes for layout A

Cup 250 ml, filled to 200 ml (20 % headroom for foam). Shots use a small cup.

| Drink | Single | Double | Strength |
| --- | --- | --- | --- |
| Gin & Tonic | 40 ml gin + 160 ml tonic | 80 ml gin + 120 ml tonic | 2 / 3 |
| Vodka Tonic | 40 ml vodka + 160 ml tonic | 80 + 120 | 2 / 3 |
| Vodka Energy | 40 ml vodka + 160 ml energy | 80 + 120 | 2 / 3 |
| Gin Energy | 40 ml gin + 160 ml energy | 80 + 120 | 2 / 3 |
| Vodka shot | 50 ml vodka | — | 3 |
| Gin shot | 50 ml gin | — | 3 |
| Tonic | 200 ml | — | 0 |
| Energy drink | 200 ml | — | 0 |

"Double" keeps the total volume constant and doubles the spirit, which is what guests expect and
keeps the cup from overflowing. Pumps run simultaneously, so the drink mixes in the cup.

### 5.4 Cups

Cups are stacked beside the kiosk: 250 ml for long drinks, small cups for shots (recommend 80–100 ml
so a 50 ml shot has headroom and a margin for nozzle alignment). Consequences:

1. `PourWithoutCap` is the only pour command in v1; `PourCap` waits for a dispenser.
2. Without a cup sensor the machine will pour onto the tray if the guest forgets the cup. So the
   pour screen makes placement explicit: a picture of the cup under the nozzle, the cup size to use
   ("Take a small cup for the shot"), and one button, **"Cup is in place, pour"**.
3. A cup-presence sensor has been requested from the hardware developer. With it, the button
   disappears and the pour starts when the cup is detected; the UI also blocks pouring if the cup
   is removed.
4. If a dispenser is added later, the protocol will need a cup-size selection (tracked in the
   protocol doc §7).

### 5.5 Bench tests (next hardware session)

1. **Probe**: `pnpm probe --port COM4` from `server/` to learn framing, tank status format and any
   boot messages. Then `--raw` with an unknown command to see `ProtocolError`.
2. **Timing**: `pnpm probe --port COM4 --pour 1:20 --i-placed-a-cup`, then 100 g, to get g/s per
   channel; repeat for each channel. Weigh the cup to compare requested vs. delivered grams.
3. **Fizz test**: pour 160 ml of chilled tonic and of energy drink; taste against a bottle pour
   after 0 and 5 minutes. Note foam height. Pass = clearly still sparkling.
4. **Spirit repeatability**: 40 ml and 80 ml of vodka ten times each; weigh. Sets the calibration
   factor and tells us how honest the "40 ml" claim is.
5. **Rinse cycle**: run `Rising` with water; check residue and how long a line takes to clear.

### 5.6 Units and calibration

The device wants grams; recipes are in ml. Server-side: `grams = ml × density × calibration`, with
density per ingredient (40 % spirits ≈ 0.95, tonic ≈ 1.03, energy drink ≈ 1.04) and a per-channel
calibration factor set from the admin screen ("pour 100 g into a measuring cup, enter what you
got"). If the firmware's "grams" turn out to be flow-meter pulses, the calibration factor absorbs it.

### 5.7 Ordering model

One cup at a time, so an order is a **queue of single drinks**, up to 4 per order (a group of
friends). Each drink is one tap for the guest: place the cup → tap Pour → watch → take it. Any more
than 4 and the line behind the kiosk suffers.

### 5.8 Operations and the fridge

- The fridge earns its place three times over: cold mutes alcohol burn and sweetness (there is no
  ice to do it), CO₂ stays dissolved in cold liquid so tonic survives the pump, and cold mixers
  foam less so 200 ml fits a 250 ml cup. Target 2–4 °C for the mixers.
- Daily: rinse cycle, visual tank check, restock cups. Weekly: full line flush with cleaner.
- Spirits and canned mixers: replace on empty. Nothing perishable in layout A.
- Prices are placeholders until the owner sets them; keep them round (e.g. 12 ₾ / 18 ₾) so the
  price ladder reads at a glance. Editable from the admin screen.

## 6. UX design

### 6.1 Confirmed context

- **Screen**: portrait, assumed 1080 × 1920 touch panel (confirm the exact resolution).
- **Guest**: standing at 50–70 cm, dim and colored bar lighting, loud music, possibly wet fingers.
  Hence: dark theme, big targets, no gestures, no sound-dependent feedback.
- **Portrait ergonomics**: the bottom third of the screen is the easiest to reach for everyone, the
  top third is a stretch for shorter guests. Primary actions live at the bottom; the top carries
  only the logo, language toggle and the cancel button.
- **Age**: no age gate; staff supervise. A small "18+" notice sits on the attract screen.
- **Languages**: Georgian default, English toggle. Georgian script needs a font that has it (§6.5).
- **Payment**: one "Pay" button, then a card-tap animation that ends in success. No QR view, no
  random declines. The real provider slots in behind the same screen later.

### 6.2 Screen flow (portrait)

| # | Screen | What the guest does | Layout notes |
| --- | --- | --- | --- |
| 1 | **Attract** | Taps anywhere | Looping animation of the drinks, "შეეხე დასაწყებად / Touch to start" near the bottom, small 18+ notice, language toggle top-right |
| 2 | **Menu** | Taps a drink | Top bar (logo, KA/EN, cancel) · category chips in one horizontal row · 2-column grid of drink cards (name, price, strength dots, illustration, "Sold out" badge); 8 drinks fit without scrolling · basket bar docked at the bottom, appears when the cart is not empty |
| 3 | **Drink sheet** | Picks size and quantity, taps Add | Bottom sheet, ~60 % height: Single / Double segmented control with prices, stepper 1–4, ingredient line ("Gin 40 ml · Tonic 160 ml"), live total, "Add" full-width at the bottom |
| 4 | **Basket bar** | Edits or pays | Docked bottom; item chips with quantity (tap to reopen the sheet, × to remove); "Pay 24 ₾" is the only primary button, bottom-right |
| 5 | **Checkout** | Reviews, taps Pay | Order summary list, total, "Back" (secondary) and "Pay 24 ₾" (primary) stacked at the bottom |
| 6 | **Paying** | Watches | Card-tap animation with the amount; success state with a check mark, auto-advance after 1.5 s |
| 7 | **Place your cup** | Places a cup, taps Pour | Illustration of the nozzle with the right cup size ("Take a small cup for the shot"), "Drink 1 of 2 · Gin & Tonic", one button: "Cup is in place, pour". For drinks 2+ this screen also says "Take your previous drink first" |
| 8 | **Pouring** | Waits | Cup fills with the drink's liquid color, progress bar with "about 10 s", "Please don't touch the cup". No buttons except "Call staff" |
| 9 | **Done** | Takes the drink | After the last drink: "Enjoy!", auto-reset in 10 s, "New order" button |
| E1 | **Out of service** | — | Device offline or in error: friendly message, "Call staff", no ordering |
| E2 | **Pour failed after payment** | Reads order number | "Sorry, drink 2 of 2 could not be poured. Order #123, please show this to the staff." Logged for refund |
| E3 | **Tank low** | — | Affected drinks hidden from the menu; staff banner on attract |
| A | **Admin** | Staff enters PIN | Hidden entry: 5 taps on the logo. Tank status, rinse, prime, test pour, calibration wizard, prices, enable/disable drinks, sales today, error log, emergency stop, restart |

Every step before payment has "Cancel order" top-right. After payment there is no cancel, only
"Call staff". Inactivity: 60 s → 10 s countdown overlay → reset, except while pouring or waiting
for a cup (there the timeout is longer, 3 min, and the drink is still poured if the guest returns).

### 6.3 Interaction rules

- One primary action per screen, at the bottom, at least 96 px tall and full-width or bottom-right.
  Secondary actions are visibly quieter (outline or text), never the same size.
- Minimum touch target 64 × 64 px with 16 px spacing. Steppers, segmented controls and category
  chips all follow this.
- Press feedback within 100 ms: `active:` scale 0.97 plus a surface color step. No `hover:`.
- No swipes, drags, long-presses or double taps anywhere in the guest flow. Category chips are
  tapped, not scrolled; with 5 categories they fit in 1080 px.
- Avoid scrolling: with 8 drinks the 2-column grid fits the viewport; if the menu grows, page it.
- Every waiting state says what is happening and roughly how long ("Pouring… about 10 s").
- Text: body 24–28 px, labels ≥ 20 px, headings 40–56 px, prices bold and tabular. Nothing under 18 px.
- Contrast ≥ 4.5:1 for all text, ≥ 3:1 for icons and borders. Color is never the only signal
  (badges carry text, strength has dots *and* a label in the sheet).

### 6.4 Colors

Dark theme by default. Bars are dark; a white screen is a glare source and looks cheap in that light.
Keep the existing violet as the brand accent (it already reads as nightlife and it is neutral across
ages and genders); reserve green, amber and red strictly for meaning.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0A0A0F` | Page background |
| `--surface` | `#14141C` | Cards, chips, bars |
| `--surface-2` | `#1D1D28` | Pressed / elevated surfaces, inputs |
| `--border` | `#2B2B3A` | Hairlines |
| `--text` | `#F4F4F8` | Primary text |
| `--text-muted` | `#9C9CB4` | Secondary text, hints |
| `--primary` | `#A78BFA` | Brand accent on dark: prices, active category, icons (7.3:1 on `--bg`) |
| `--primary-strong` | `#7C3AED` | Primary button fill, white text (5.7:1) |
| `--success` | `#34D399` | Payment success, pour done, "in basket" |
| `--warning` | `#FBBF24` | Low stock, inactivity countdown |
| `--danger` | `#F87171` | Cancel, errors, remove |
| `--info` | `#38BDF8` | Informational banners |

Optional category tints, used only as small accents (icon, card edge): Shots amber, Mixes violet,
Energy cyan, Soft drinks teal. Liquid colors for the pour animation come from the ingredient config
(gin/vodka near-clear with a cool tint, tonic pale, energy drink gold) and blend by proportion.

If the bar's own branding is warm, the same token set works with an amber primary
(`#F59E0B` / `#FBBF24` on dark); nothing else changes. Tokens live in `styles/tokens.css` and are
mapped into Tailwind's `@theme`, so components never reference raw palette classes.

### 6.5 Typography, imagery, motion

- **Font**: Noto Sans Georgian (covers Georgian *and* Latin), weights 500 / 700 / 900, bundled with
  `@fontsource/noto-sans-georgian`. No runtime Google Fonts request.
- **Illustrations** instead of photos: one consistent SVG glass per drink, recolored by liquid.
  Offline, tiny, on-brand, and the same asset animates on the pouring screen.
- **Motion**: 150–250 ms ease-out for state changes; the pour animation is continuous; success and
  failure are full-screen states.
- **Copy**: short, friendly, imperative ("Cup is in place, pour", "Take your drink"). Georgian and
  English in `packages/shared/i18n` as typed keys; a 40-line hook is enough.

## 7. Roadmap

Estimates assume one developer on the software, with the hardware developer available for questions.

### Phase 0 — Align (done 20 Sep, one item left)

- Decisions taken (§8). Protocol questions drafted in Georgian for the hardware developer.
- **Next hardware session**: run the probe and the bench tests (§5.5); record results in the protocol doc.

### Phase 1 — Foundation refactor (1–2 weeks)

- `packages/shared` with API types, protocol enums, zod schemas, i18n keys.
- Server: **done 20 Sep** — layered structure (§4.2), config loading, pino logging, SQLite, mock driver,
  serial driver (not yet run against the hardware), menu/orders/device API, SSE hub, admin and dev
  endpoints, static serving of the client build.
- Client: portrait layout, design tokens, kiosk hardening, error boundary, i18n scaffold, local
  assets, cart store cleanup, menu fed by the API, checkout wired to `POST /api/orders` + mock
  card-tap payment, place-cup / pouring screens driven by SSE events from the mock driver. Delete
  dead code from the audit table.
- Vitest: **done for the server** — pour planner, config, device controller, serial transport
  (mock port), order service, HTTP API.
- Outcome: the full guest flow works end to end against the mock device.

### Phase 2 — Hardware integration (1–2 weeks)

- Real serial driver: framing (from the probe), queue, timeouts, `StopWorking`, reconnect, raw-frame logging.
- Tank polling → availability; pour orchestration with per-channel error mapping.
- Admin screen: PIN, tank status, rinse, prime, test pour per channel, calibration wizard,
  price and availability editing, error log, emergency stop.
- Bench checklist: unplug USB mid-pour, empty tank, power cycle mid-order, 50 pours in a row.

### Phase 3 — Polish and pilot (1–2 weeks)

- Attract loop, Georgian copy review, illustrations, animation pass.
- Kiosk OS setup on the Linux mini-PC: auto-login, autostart, screen blanking and updates disabled
  during opening hours, Chromium flags (`--kiosk --noerrdialogs --disable-pinch
  --overscroll-history-navigation=0 --incognito`), systemd unit, udev rule, watchdog.
- Pilot in the bar for a weekend with staff-supervised payment; collect sales per drink, failure
  counts, average order time.

### Phase 4 — Payment (when a provider is chosen)

- Adapter interface with the mock already in place; implement the chosen provider(s):
  Keepz QR and/or a bank POS terminal via its ECR integration (to be confirmed with the bank).
- Refund policy for failed pours (manual by staff in v1, logged with order number).

### Later

Cup sensor integration (zero-tap pouring), cup dispenser, second machine support, remote monitoring,
happy-hour pricing, promo codes, receipt printer.

## 8. Decisions log (20 Sep 2026)

| Topic | Decision |
| --- | --- |
| Screen | Portrait 9:16 (exact resolution to confirm; 1080 × 1920 assumed) |
| Channels | Layout A: Vodka, Gin, Tonic, Energy drink |
| Payment | Not chosen. v1 ships a "Pay" button with a card-tap animation; adapter stays mocked |
| Languages | Georgian + English |
| Cups | Stacked beside the kiosk, guest places them: 250 ml for long drinks, small cups for shots. Dispenser maybe later |
| Cup sensor | Not present yet, possible; requested from the hardware developer |
| Cooling | Integrated fridge |
| Kiosk OS | Linux mini-PC |
| Currency / prices | GEL (₾); placeholder round prices, set by the owner from the admin screen |
| Age gate | None; staff supervise; 18+ notice on the attract screen |
| Device access | On Lasha's desk, USB; next hardware session runs the probe |
| Protocol facts | Multi-channel pours are simultaneous; payload values above 255 are fine |

Still open: exact panel resolution, small cup volume, price list, payment provider, and the hardware
questions in the protocol doc §7.

## 9. Definition of done for v1

- A guest completes an order with two different drinks, through the mocked payment, placing their
  own cups, with no help.
- Tank-low ingredient hides its drinks within 60 s; "flowmeter error" and "tank empty" show the
  correct screens and log the order for refund; USB unplug shows "Out of service" and recovers on replug.
- Staff can calibrate a channel and change a price without touching code.
- Server restarts automatically after a crash; the UI never shows a browser error page.
- Lint, type-check and tests pass in CI.
