# Drinko server

Node + TypeScript service for the kiosk PC. It owns the vending board, keeps the menu and orders,
exposes a local HTTP + SSE API, and serves the built React client.

## Run

```
pnpm install                 # from the repo root
cd server
cp .env.example .env         # defaults use the simulated board
pnpm dev                     # http://localhost:8000, restarts on change
```

Against the real machine: set `HARDWARE=serial` and `SERIAL_PATH` (`COM3`, `/dev/ttyUSB0`, …) in `.env`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | ts-node + nodemon |
| `pnpm test` | vitest, all against the simulated board and an in-memory SQLite |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build && pnpm start` | compile to `dist/` and run |
| `pnpm probe --port COM3` | raw serial probe of the Drinko board, see `docs/HARDWARE_PROTOCOL.md` §8 |

## Layout

```
config/drinko.json      channels, ingredients, drinks, prices, timeouts (edit by hand)
src/
  index.ts              bootstrap and shutdown
  env.ts                environment variables (zod)
  config/               config schema + loader with cross-reference checks
  hardware/
    driver.ts           DeviceDriver: the interface every board implements (channels, grams, tanks, cup events)
    device-controller.ts board-agnostic: one command at a time, timeouts, reconnect, tank polling, error state
    registry.ts         HARDWARE name → driver instance
    errors.ts           DeviceTimeoutError, DeviceDisconnectedError, …
    drinko-json/        the current board: protocol codec, framing, serial + mock transports, driver
  domain/
    types.ts            API contract types (to move to packages/shared with the client refactor)
    catalog.ts          config + tank status → menu with availability
    pour-planner.ts     recipe ml → grams per channel, expected duration
    order-service.ts    order state machine, payment and pour orchestration, sweeper
  payment/              PaymentAdapter interface + mock (card-tap delay, always succeeds)
  db/                   node:sqlite database, order and settings repositories
  events/bus.ts         typed domain events
  api/                  express app, routes, SSE hub
  scripts/probe-device.ts
```

## Supporting another board

The kiosk only ever talks to `DeviceDriver` (`src/hardware/driver.ts`): connect, `checkTanks()`,
`pour({ grams, withCup, timeoutMs })`, `stop()`, `rinse()`, plus `connected`/`disconnected`/`cup`
events and a `capabilities` block (channel count, cup sensor, dispenser, rinse, tank levels). The
controller, orders, API and menu adapt to the capabilities; nothing above the driver knows a wire
protocol.

To add a board:

1. Create `src/hardware/<board>/` with a class implementing `DeviceDriver`. Map the board's own
   errors to `PourFailure` values and throw the shared errors from `errors.ts` on timeout,
   disconnect, or refusal.
2. Add its name to `HARDWARE` in `env.ts` and a case in `registry.ts`.
3. Set `channels` in `config/drinko.json` to the board's channel count; startup refuses a mismatch.
4. Tests: `device-controller.test.ts` shows a fake six-channel board driven through the controller.

## API

All JSON, all under `/api`. Errors look like `{ "error": { "code", "message" } }`.

| Method & path | Purpose |
| --- | --- |
| `GET /health` | `{ ok, uptimeSec, device }` |
| `GET /menu` | categories, ingredients with tank status, drinks with sizes, prices and availability |
| `GET /device/status` | `{ driver, capabilities, connected, state, errorKind, tanks[], lastError, lastTankCheckAt }` |
| `POST /device/stop` | emergency stop, bypasses the queue |
| `GET /events` | SSE: `device.status`, `order.updated`, `pour.started`, `pour.done`, `pour.failed`; sends a snapshot on connect |
| `GET /orders/active` | the order currently occupying the kiosk, or `null` |
| `POST /orders` | `{ items: [{ drinkId, size, quantity }] }` → 201 order |
| `GET /orders/:id` | order |
| `POST /orders/:id/pay` | starts payment → 202; result arrives as `order.updated` |
| `POST /orders/:id/pour` | guest placed the cup → 202; pour result arrives over SSE |
| `POST /orders/:id/cancel` | only while `created` |
| `GET /admin/tanks` | forces a tank check (header `x-admin-pin`) |
| `POST /admin/clear-fault` | staff fixed the machine: drop the fault, check the board answers, return status |
| `POST /admin/test-pour` | `{ channel: 1-based, grams }` |
| `POST /admin/rinse` | `{ channels: [bool per channel] }` |
| `GET/PUT /admin/settings` | `{ calibration[], flowRateGps[], disabledDrinks[] }`, one entry per channel |
| `GET /admin/orders?limit=` | recent orders |
| `GET/PUT /api/dev/mock` | mock only: `{ tankGrams, faults, cupsAvailable, timeScale, flowRateGps, lowThresholdGrams, replyStyle }` |
| `POST /api/dev/mock/disconnect` | mock only: pull the virtual USB cable |

## Order lifecycle

`created` → `paying` → `awaiting_cup` → `pouring` → `awaiting_cup` … → `completed`.
A pour failure ends in `failed` with the remaining pours `skipped`. `cancelled` is only reachable
from `created`; the sweeper turns stale `created` orders into `cancelled` and stale `awaiting_cup`
orders into `abandoned` (paid, staff should refund). One active order at a time; `POST /orders`
answers 409 otherwise.

## Error handling

| Situation | What the server does |
| --- | --- |
| USB unplugged, port closed | state `disconnected`, orders refused with 503, tanks unknown, reconnect every 3 s |
| Board goes silent while the port is open (power off, hung firmware) | tank poll fails → state `error`, kind `unresponsive`; polls every 5 s; after 3 failures the link is closed and reopened. Clears itself when the board answers again |
| Pour never ends | after expectedMs × 2 + 5 s: stop command, order `failed` with `timeout`, state `error`, kind `fault` |
| Board reports tank empty or no cup | pour fails with that reason, the channel is marked low and its drinks hidden; the device stays usable |
| Board reports a flowmeter or hardware fault, in a pour or on its own | pour fails, state `error`, kind `fault` |
| Board reports nothing (current firmware) and the pour ends faster than expectedMs × 0.25 | treated as nothing having flowed: pour fails with `flowmeter`, state `error`, kind `fault`. `device.suspiciousPourRatio` in the config, 0 disables |
| Any `fault` | no orders until staff press "cleared" in the admin screen (`POST /admin/clear-fault`). A working tank check does not prove a pump works, so faults never clear themselves and survive a reconnect |
| Payment declined | order back to `created` for another try |
| Guest walks away | sweeper cancels unpaid orders after 5 min and abandons paid ones after 3 min without a cup |

Every failure is visible in the order (`failure`, and per pour), in `GET /device/status` (`state`,
`lastError`) and on the SSE stream, so the UI can show the right screen and staff can act.

## Simulated board

With `HARDWARE=mock` pours take real time (`MOCK_TIME_SCALE=1`, about 12 s for a 200 ml drink) so
the client's progress animation can be developed honestly. Set `MOCK_TIME_SCALE=0` for instant
pours. Use `PUT /api/dev/mock` to empty a tank, inject a flow meter fault, slow the pumps, or switch
`replyStyle` to `echo` (how the real firmware behaved on 20 Sep 2026), and
`POST /api/dev/mock/disconnect` to see the reconnect loop and the "Out of service" path.
