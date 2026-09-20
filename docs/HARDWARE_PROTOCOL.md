# Drinko Vending Device — Serial Protocol

English working copy of the hardware developer's Google Doc "Protocol Command Flow"
(last updated 18 May 2024, marked by its author as still in development), plus everything the
probe established on **20 Sep 2026** with the real device on Lasha's desk (nothing attached to it:
no pumps running, no nozzle, no liquid). Update this file whenever the firmware changes.

Code: `server/src/hardware/drinko-json/` (protocol codec, framing, serial and mock transports, driver).
The rest of the server never sees this protocol; it talks to the `DeviceDriver` interface in
`server/src/hardware/driver.ts`, so another board is another folder plus a registry entry.
Probe tool: `server/src/scripts/probe-device.ts` (§8). Raw logs: `server/probe-logs/`.

## 1. Transport

| Item | Value |
| --- | --- |
| Physical link | FTDI FT232 USB → UART bridge (VID 0403, PID 6001). `COM3` on Lasha's PC, `/dev/ttyUSB0` on Linux. Windows and Linux have the driver built in |
| Baud rate | 115200 — **confirmed**; other rates produce garbage both ways |
| Data bits / parity / stop | 8N1, no flow control — **confirmed**; DTR/RTS state does not matter |
| Framing, master → device | JSON followed by `\n` — **confirmed**. Pretty-printed requests with tabs and newlines are accepted too. The device processes a line as soon as `\n` arrives: an unterminated object is rejected immediately, it does not wait for a closing brace |
| Framing, device → master | Pretty-printed JSON with tabs and newlines *inside* the object and **no terminator after the closing brace** — **confirmed**. The host must frame by brace matching, never by lines |
| Reply latency | 16–28 ms for every command |
| Boot behaviour | Nothing unsolicited after opening the port; no banner on a DTR or RTS pulse |

## 2. Message shape

Both directions use the same JSON object:

```json
{ "Status": 0, "CommandType": 0, "Payload": [0, 0, 0, 0] }
```

| Field | Master → device (request) | Device → master (response) |
| --- | --- | --- |
| `Status` | Always `0` | Protocol status, see §4 and §3.2 |
| `CommandType` | Command id, see `Vending_CommandType` | Normally an echo of the request's command id; for a rejected request it is the command the device is running or last ran (§3.2) |
| `Payload` | Always 4 integers, one per **port**. Meaning depends on the command | Always 4 integers, one per port. Meaning depends on the command and on the firmware's current behaviour (§3.1) |

A **port** is one complete channel: tank + pump + flow sensor + valve. Index 0 is port 1.
So the device has exactly **4 liquid channels**. Payload values are **not limited to 255**.

## 3. Semantics

### 3.1 As documented

- Strict master/slave request–response. The master sends one command and waits for the reply.
- Only **one command in flight**. If the master sends anything while the device is executing a
  command, the device answers with `Status = DeviceBUSY (2)`.
- The single exception is `StopWorking`, which may be sent at any time, including while a pour runs.
- The reply to a pour arrives **only after the pour has finished or failed**, carrying one
  status per channel. There are no intermediate progress messages.
- When several channels are non-zero in one pour, **all pumps run at the same time**.

### 3.2 As observed on 20 Sep 2026 (firmware on the desk)

The first two points hold. The pour reply does **not** behave as documented:

- **A pour is acknowledged immediately.** `PourWithoutCap [20,0,0,0]` was answered in 28 ms with
  `Status 0` and `Payload [20,0,0,0]`, an echo of the request, not per-channel statuses.
- **The pour then runs in the background.** Every message sent meanwhile gets `Status 2`. With
  nothing attached the busy period was under 550 ms.
- **No result message was seen** afterwards, neither unsolicited nor on the next CheckTank. The
  host therefore cannot learn today whether a pour succeeded or why it failed (§7 #18).
- **`Status 2` is also the answer to a rejected request** while idle: unknown `CommandType 9`,
  a 2-element payload, and broken JSON all got `Status 2`. `ProtocolError (1)` was never seen.
- **The `CommandType` in a rejection is not the request's.** During the pour, rejected messages
  echoed `CommandType 1` (the running pour); while idle they echoed `CommandType 2` (the last
  CheckTank). A rejected request that *did* parse with a known type (the short payload) echoed its
  own type. The host driver copes: with one request in flight, any reply is treated as its answer.
- **CheckTank answers all zeros** (§5.2).
- `StopWorking` while idle answers `Status 0`, zeros.

## 4. Enums

```c
typedef enum Vending_ProtocolStatus {      // response.Status
    DeviceOK = 0,
    ProtocolError = 1,                     // never observed; rejections come back as 2
    DeviceBUSY = 2
} Vending_ProtocolStatus_t;

typedef enum Vending_CommandType {         // request/response.CommandType
    PourCap = 0,          // drop a cup from the dispenser, then pour (no dispenser in v1)
    PourWithoutCap = 1,   // pour into the cup already under the nozzle (v1 default)
    CheckTank = 2,        // report tank levels
    Rising = 3,           // most likely "Rinsing": cleaning cycle
    StopWorking = 4       // emergency stop, allowed while busy
} Vending_CommandType_t;

typedef enum Vending_CommandStatus {       // response.Payload[i], as documented
    PouringOK = 0,
    PouringFailedTankEmpty = 1,
    PouringFailedNoCup = 2,
    PouringFailedFlowmeterError = 3,
    PouringFailedHardwareError = 4,
    TankOK = 5,
    TankLow = 6
} Vending_CommandStatus_t;
```

## 5. Commands

### 5.1 PourCap (0) and PourWithoutCap (1)

Request payload: grams to dispense from each channel. `0` means the channel is not used.

Documented device sequence:

1. Check the tank level of every requested channel. Not enough liquid → abort, respond with
   `PouringFailedTankEmpty`.
2. `PourCap` only: drop a cup. No cup available → abort, respond with `PouringFailedNoCup`.
3. Run the pump(s) and measure flow with the flow meter. No flow detected → the pump or the sensor
   is faulty → `PouringFailedFlowmeterError` (or `PouringFailedHardwareError`).
4. Everything fine → `PouringOK`.

Observed (§3.2): immediate echo, BUSY while running, no result. Exchange as recorded:

```
→ {"Status":0,"CommandType":1,"Payload":[20,0,0,0]}\n
← {                                   (28 ms later)
	"Status":	0,
	"CommandType":	1,
	"Payload":	[20, 0, 0, 0]
}
→ {"Status":0,"CommandType":2,"Payload":[0,0,0,0]}\n     (350 ms later)
← { "Status": 2, "CommandType": 2, "Payload": [0, 0, 0, 0] }   still busy
→ {"Status":0,"CommandType":2,"Payload":[0,0,0,0]}\n     (550 ms later)
← { "Status": 0, "CommandType": 2, "Payload": [0, 0, 0, 0] }   idle again, no result message
```

v1 uses `PourWithoutCap` only: there is no cup dispenser, the guest places a cup under the nozzle.
`PourWithoutCap` has **no cup check**, so the software makes cup placement an explicit step
(PLAN.md §5.4) until a cup sensor exists.

### 5.2 CheckTank (2)

Request payload: ignored, send zeros. Documented reply: `TankOK` (5) or `TankLow` (6) per channel.

Observed: `Payload [0, 0, 0, 0]` every time, in 16–25 ms, formatted as in §1. Zero reads as
`PouringOK` in the enum, not as a tank status. Either CheckTank is not implemented yet, or 0 means
"ok" here, or the tanks were simply empty (§7 #16). Until answered, the host treats 0 as "unknown"
and keeps every drink orderable. While a pour runs, CheckTank answers `Status 2`, which is how the
host detects the end of a pour (§8).

### 5.3 Rising (3)

Presumably a rinsing / cleaning cycle. Payload meaning (which channels, how long, water source)
is not documented. Not sent yet.

### 5.4 StopWorking (4)

Emergency stop. May be sent while another command is executing. Observed while idle: `Status 0`,
zeros, 16 ms. Not yet observed during a pour.

## 6. Inconsistencies in the source document

1. The examples section shows **SetCapVolume = CommandType 2** and **GetCapVolume = CommandType 3**
   with payload `[50, 20, 20, 80]`, but the enum defines `2 = CheckTank` and `3 = Rising`.
   Note that the pour echo observed in §3.2 looks exactly like the SetCapVolume example (request
   payload echoed back), which suggests the examples describe the firmware's real reply style.
2. `Rising` is almost certainly a typo for `Rinsing`.
3. Units: the payload is described as **grams**, but flow meters measure volume (pulses per ml).
   Treat the number as "device units" and calibrate host-side (see PLAN.md §5.6).
4. `ProtocolError` is documented but every rejection observed came back as `DeviceBUSY`.

## 7. Questions for the hardware developer

Status as of 20 Sep 2026. A Georgian version was drafted the same day for pasting to the developer.

| # | Question | Status |
| --- | --- | --- |
| 1 | Framing, checksum, max message length | **Answered by probe**: `\n` after our JSON, no checksum, pretty-printed replies without terminator. Max length unknown |
| 2 | Value range | **Answered**: larger than 255 is fine |
| 3 | Multi-channel pours | **Answered**: simultaneous |
| 4 | Flow rate per pump in g/s | Needs a pour with liquid |
| 5 | Longest possible pour | Ask |
| 6 | TankLow threshold; pouring allowed while low? | Ask |
| 7 | Cup-presence sensor request (v1 has no dispenser; guests place cups; `PourWithoutCap` should refuse without a cup; report cup placed/removed) | Ask (request) |
| 8 | Small cups (~80 ml) for shots under the same nozzle | Ask |
| 9 | `Rising` / `StopWorking` semantics; what a pour returns when stopped mid-way | Ask |
| 10 | When is `ProtocolError (1)` returned? Every rejection observed was `2` | Ask |
| 11 | Unsolicited messages, identify / firmware-version command | Probe: none at open or on DTR/RTS pulse. Identify command: ask |
| 12 | Power loss during a pour: state after reboot, reset needed? | Ask |
| 13 | Are `SetCapVolume` / `GetCapVolume` real commands or stale examples? | Ask (the pour echo suggests they are real) |
| 14 | Are "grams" flow-meter pulses calibrated on water, or weight? | Ask |
| 15 | Anything missing from the enum; how will we learn about firmware changes? | Ask |
| 16 | **CheckTank answers all zeros.** Implemented? Does 0 mean ok, or should we expect 5/6? Were the tanks empty? | Ask |
| 17 | The device was silent until Lasha "checked it". What had to be powered or reset? The kiosk must come up unattended | Ask |
| 18 | **Pour result.** The pour is acknowledged at once by echoing the request and nothing follows. How do we learn that a pour finished and whether it succeeded (tank empty, no flow…)? Will a result message be sent later, or should the host poll CheckTank until it stops answering `2`? | Ask, blocking for a reliable kiosk |
| 19 | **Rejected requests answer `Status 2`** with the CommandType of the running or last command. Intended? Can rejections use `ProtocolError (1)` and echo the request's CommandType? | Ask |
| 20 | With nothing attached, a 20 g pour ended in under 550 ms. What ended it (no-flow timeout, tank check)? What is that timeout with a real pump? | Ask |

## 8. Host-side tooling and driver rules

### Probe

```
cd server
pnpm probe                                  # list serial ports
pnpm probe --port COM3                      # listen, then CheckTank with \n, \r\n, no terminator
pnpm probe --port COM3 --pour 1:20 --i-placed-a-cup   # one timed 20 g pour from channel 1
pnpm probe --port COM3 --raw '{"Status":0,"CommandType":9,"Payload":[0,0,0,0]}'
pnpm probe --port COM3 --stop               # StopWorking
```

It prints every byte in both directions and writes `server/probe-logs/<timestamp>.log`, which can
be sent to the hardware developer verbatim. Ctrl+C during a pour sends `StopWorking`.

### Driver rules (implemented in `drinko-json/driver.ts`, `drinko-json/serial-transport.ts` and the board-agnostic `device-controller.ts`)

- Open the port at 115200 8N1, frame incoming bytes by brace matching (`framing.ts`), validate every
  message with the zod schema in `protocol.ts`; log raw frames at debug level.
- **Single-slot command queue** (controller): at most one command in flight, all others wait.
  `StopWorking` bypasses the queue and is written immediately.
- **Reply matching**: by CommandType; with a single request in flight, any reply is its answer
  (covers the rejection behaviour in §3.2).
- **Pour**: send, expect the echo acknowledgement, then poll CheckTank every 500 ms until the
  device stops answering `2`. If a message with the pour's CommandType arrives in the meantime it
  is taken as the result and interpreted per §4. If the device simply goes idle, the pour is
  assumed successful and logged as such. If the documented behaviour appears instead (a status
  reply straight away), it is interpreted directly.
- **Timeouts**: `CheckTank` 2 s; pour = estimated duration × 2 + 5 s including the busy period.
  On timeout send `StopWorking` and mark the device as faulted: no orders until staff clear the
  fault from the admin screen. Faults never clear themselves, since a working `CheckTank` says
  nothing about a pump.
- **`Status 2` on a non-pour request**: retry after 500 ms, up to 5 times, then give up. This
  also covers rejected requests, which is harmless.
- **Silent board**: the periodic CheckTank doubles as a liveness probe. A failed poll marks the
  device unresponsive (no orders), polls continue every 5 s, and after 3 failures the port is
  closed and reopened. This state clears itself when the board answers again.
- **Implausibly short pour**: because the firmware reports no result, a pour that ends before
  25 % of its expected duration is treated as "nothing flowed" (pump or flowmeter dead) and puts
  the device in error. On a bare board every pour trips this, by design.
- **Unsolicited failure statuses** with a pour CommandType outside a pour are treated as a fault
  report and put the device in error.
- **Reconnect loop**: on port close or error, retry every 3 s and publish `device.status`
  events so the UI can show "Out of service". On Linux, a udev rule gives the device a stable
  path (`/dev/drinko`) so the config does not depend on `ttyUSB0`.
- **Mock driver** with the same interface for development. `replyStyle: 'status'` follows the
  documented behaviour (result at the end, per-channel statuses), `replyStyle: 'echo'` follows the
  firmware as observed (echo, BUSY, no result).
