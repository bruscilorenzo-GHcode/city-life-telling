# CITY-LIFE-TELLING · MATSim live bridge

The living-lab seam between a **MATSim multi-agent simulation**
(Polytechnique Montréal) and the City-Life-Telling app
(<https://city-life-telling.vercel.app>).

```
┌──────────────────────────────┐      POST /push/snapshot        ┌──────────────────┐
│  MATSim (Polytechnique)      │ ────── partial or full ───────▶ │  bridge (Node)   │
│  ControlerListener / replay  │      clt.matsim.snapshot.v0     │  merge+validate  │
│  or output_events replay     │ ────── POST /push/weather ────▶ │  fan-out (SSE)   │
└──────────────────────────────┘      clt.weather.v0             └────────┬─────────┘
                                                                          │ GET /stream (SSE, live)
                                                                          │ GET /snapshot.json (poll)
                                                                          ▼
                                                               City-Life-Telling app
                                                               (AVA + decision model)
```

The bridge is **zero-dependency Node ≥ 18** (~250 lines): it validates,
merges and forwards. It never invents transport data.

## 1 · Run it

```bash
node matsim-bridge/server.mjs                 # http://localhost:8787
BRIDGE_TOKEN=s3cret node matsim-bridge/server.mjs   # lock POSTs with a token

# workshop demo without touching the MATSim model — a compressed 24h day:
node matsim-bridge/push-simulator.mjs                       # 20× ⇒ a day in ~72 s
node matsim-bridge/push-simulator.mjs http://localhost:8787 60 500   # 60×, every 500 ms
```

`npm run bridge` and `npm run bridge:sim` do the same from the repo root.

## 2 · Connect the app

In the app (Urban Strategist mode → MATSim console → *snapshot endpoint*):

| Endpoint | Behaviour |
|---|---|
| `http://localhost:8787/stream` | **SSE live push** — the browser subscribes; updates appear the instant MATSim pushes. Recommended. |
| `http://localhost:8787/snapshot.json` | HTTP poll every 10 s. |
| *same fields* on the weather slot | `/stream` and `/weather.json` are both understood. |

Local workshop: run the app with `npm run dev` (http://localhost:5175) and
the endpoint can stay plain `http://`. The deployed HTTPS app **needs
TLS** (browsers block mixed content): put the bridge behind a tunnel —
`cloudflared tunnel --url http://localhost:8787` or `ngrok http 8787` —
and paste the `https://…` URL. CORS is already open (`*`).

## 3 · What the MATSim side pushes

**Full snapshot** (self-contained, replaces everything):

```json
{
  "contract": "clt.matsim.snapshot.v0",
  "scenario": "mtl-2026-11-06-live",
  "generatedAt": "2026-11-06T13:20:00Z",
  "tick": 342,
  "lines": [
    {
      "lineId": "metro-green",
      "status": "delayed",
      "avgDelaySec": 240,
      "headwayMin": 6.5,
      "load": 0.82,
      "activeAgents": 4200,
      "incidents": [
        { "id": "inc-1", "kind": "signal", "at": [45.5152, -73.5613],
          "severity": 0.8, "note": "signal fault at Berri-UQAM" }
      ]
    }
  ],
  "agents": { "onboard": 38400, "waiting": 12600, "avgTripMin": 27 },
  "meta": { "iteration": 12, "note": "free-form" }
}
```

**Partial push** (recommended for a live listener — upserts by `lineId`;
the bridge keeps every other line untouched):

```json
{ "scenario": "mtl-2026-11-06-live", "lines": [ { "lineId": "metro-orange", "load": 0.91, "avgDelaySec": 310 } ] }
```

`status` ∈ `nominal · irregular · delayed · disrupted · suspended`;
`avgDelaySec` mean signed vehicle delay; `load` occupancy 0..1;
`activeAgents` MATSim agents en route; incident `kind` ∈
`mechanical · signal · crowding · weather · service · collision`, `at` is
`[lat, lon]`, `severity` 0..1.

Weather (`clt.weather.v0`): `periods[]` of `{ id: now|next|later, hours,
tempC, precipMm, precipKind: none|rain|snow|freezing, windKmh,
alert: none|wind|snow|ice|storm|heat|cold }` — optional: the app simulates
weather when absent.

## 4 · Wiring MATSim (reference snippet)

Reference only — the Polytechnique team adapts idioms and types. Two
proven modes:

**A · Rolling re-simulation** (robust): MATSim re-runs with current counts
every N minutes; at `IterationEndsEvent` the listener posts the state of
every transit line.

```java
public final class CityLifeBridgeListener implements IterationEndsListener {
    private final HttpClient http = HttpClient.newHttpClient();

    @Override public void notifyIterationEnds(IterationEndsEvent event) {
        String body = buildSnapshotJson(event);       // per-line state from your network
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(System.getProperty("clt.bridge", "http://localhost:8787")
                + "/push/snapshot"))
            .header("Content-Type", "application/json")
            .header("x-bridge-token", System.getProperty("clt.token", ""))
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        http.sendAsync(req, HttpResponse.BodyHandlers.discarding());
    }
}
// controler.addControlerListener(new CityLifeBridgeListener());
```

**B · Live replay of a finished run** (fastest workshop): stream
`output_events.xml` (`VehicleDepartsStop`/`PersonArrival` per transit
route) through the bridge's `POST /push/snapshot` in partial pushes,
compressed in time — the app sees the day "happen". The bundled
`push-simulator.mjs` is a working skeleton for exactly this shape.

**C · Full live listener** (research mode): a sim-step listener aggregating
per-line delays/loads every 60 sim-seconds and pushing partials — closest
to a true digital twin; same contract, nothing changes downstream.

## 5 · What AVA does with the live feed

All deterministic (no LLM, reproducible, auditable — advisory only):

- **Story cross-check** (`src/city-life-telling/ava-agent.ts`): each
  citizen story's claims (line + what happened) are compared with the live
  line state → `confirms · partially · diverges · out-of-sim`, with a
  factor trail. Feed fields that matter: `avgDelaySec`, `load`, `status`,
  `incidents[].kind`.
- **Decision model** (`src/city-life-telling/strategy.ts`): ranks up to 5
  strategies crossing the weather forecast with congestion (winter ops,
  storm advisory, congestion relief, shuttle bridge, thermal points, story
  call, story gap) — priority 0..100, horizon, factors. Visible in the
  Urban Strategist box behind the provisional AVA key.
- **Signal engine** (`src/city-life-telling/signal.ts`): measures the
  fictional vs factual content of every story — the community becomes a
  sensor layer on top of the simulation.

## 6 · Workshop checklist (≈10 minutes to live)

1. `node matsim-bridge/server.mjs` (or `npm run bridge`)
2. `node matsim-bridge/push-simulator.mjs` (or the Polytechnique emitter)
3. open the app → Urban Strategist → MATSim console → endpoint
   `http://localhost:8787/stream` → *connect*
4. the map goes live (`live · tick n`), KPIs fill, AVA cross-checks every
   published story against the pushed state
5. citizens (Citizens mode) publish fictional+functional stories on the
   same live map; the wall ranks them by data value
6. for remote participants: expose the bridge via
   `cloudflared tunnel --url http://localhost:8787` and paste the HTTPS URL

## 6½ · Recording a research session

```bash
BRIDGE_RECORD=/tmp/clt-session.jsonl node matsim-bridge/server.mjs
curl -s http://localhost:8787/export > session-bridge-export.json
node matsim-bridge/verify.mjs http://localhost:8787    # pre-session go/no-go
```

`/export` returns the in-memory history (`city-life-telling.bridge-export.v1`),
`BRIDGE_RECORD` appends every accepted push as JSONL (`{at, kind, payload}`).
Pair both with the app's *exporta JSON* (Urban Strategist, research-export v1:
stories with `snapshot_ref`/`prompt_ref`) — without both, the session cannot
be replayed. Test tasks and measures: `docs/RESEARCH_TEST_PROTOCOL.md`.

## 7 · Hardening

- `BRIDGE_TOKEN` locks every POST (401 otherwise) — the browser only ever
  GETs, so the token never reaches the client.
- Payloads capped at 2 MB; malformed pushes are rejected with a reason.
- SSE heartbeats every 15 s; clients auto-reconnect (EventSource).
- Bridge state is in-memory and disposable: nothing to back up, nothing to
  leak. Persistent archives belong to the MATSim side.
