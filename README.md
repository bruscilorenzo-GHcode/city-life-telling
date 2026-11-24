# CITY-LIFE-TELLING

Realtime urban simulation of Montréal's public-transport networks (MATSim),
geolocated citizen stories with a **two-channel** structure — a fictional /
dramaturgical channel and a critical-functional channel — read and crossed by
**AVA**, the deterministic storytelling agent.

Dedicated repository of the app (governance: *one app = one repository*); the
MUSI—CO suite hosts a vendored dev copy and links the live reference.

**Live:** https://city-life-telling.vercel.app

## Commands

```bash
npm install
npm test            # Vitest: unit + end-to-end MATSim ⇄ stories bridge test
npm run build       # tsc -b && vite build
npm run dev         # Vite dev server on :5177

npm run bridge      # MATSim bridge (zero-dep Node, push/merge/SSE) on :8787
npm run bridge:sim  # replay of a compressed simulated day
npm run ava-record  # SOR record CLI (Ava Story Record 1.0)
```

## Map of the code

```
src/city-life-telling/
  CityLifeTelling.tsx        UI (rail impostazioni, mappa, compositore, AVA box, muro, console)
  store.ts                   CityStory, publish pipeline, autoria, chiave AVA, share codec
  signal.ts                  misura fiction⇄facts (FACTS/FICTION/reality index/indicatori)
  ava-agent.ts               claim extraction + incrocio con snapshot + parti/factors
  strategy.ts                decision model deterministico (meteo × congestione × community)
  ava-key.ts                 chiave provvisoria del box AVA (rotazione mensile)
  media-db.ts                media locali (IndexedDB, ≤10 MB, id opachi)
  weather.ts                 contratto clt.weather.v0 + sorgenti simulata/HTTP-SSE
  i18n.tsx                   stringhe IT/EN + lessico condiviso
  prompts.ts                 prompt di simulazione dichiarati
  ava_record/                SOR: record senza testo grezzo, routing 6 classi theta, invariants, CLI
  matsim/                    contratti snapshot, seed Montréal, sorgente simulata, HTTP/SSE, calibrazione
  main.tsx                   boot standalone
matsim-bridge/               bridge Node zero-dep: push/merge/SSE + replay simulator
schemas/                     schema Ava Story Record 1.0 (byte-identical to the normative copy)
```

## Vendored files (do not hand-edit)

- `src/assist-urban/pipeline/pii.ts` and `src/assist-urban/pipeline/consent.ts`
  — PII sanitisation + consent validation, vendored byte-identically from the
  [Urban Assist reference
  repo](https://github.com/bruscilorenzo-GHcode/urban-assist). Sync manually if
  the upstream modules change; the app imports them as
  `../assist-urban/pipeline/*.ts` (store) and `../../assist-urban/pipeline/pii.ts`
  (`ava_record/emit.ts`).

## Normative documents

The methodological contract (SOR, novelty, IRC, reward, non-negotiables) lives
in the suite repository under `docs/integration/` (`AGENT_SPEC.md`,
`Storytelling_Quantitativo_Protocollo_Novelty_Reward.md`, `docs/RECON.md`,
`AVA_Story_Record_v1_agent_brief.md` + schema) and is served to researchers at
`https://musico-syntagma-suite.netlify.app/developer/`. The suite is the
canonical source; this repository carries the byte-identical schema copy
(`docs/integration/ava-story-record-1.0.schema.json`) that the record contract
tests enforce, plus its vendored mirror in `schemas/`.

## Non-negotiables (abridged — full list in the normative docs)

- No extracted field without a literal `span` quote of the citizen's text.
- No generative model in the functional extraction path (no external calls).
- Never rewrite the citizen's text in the record.
- `utilityPlan = 0` until a calibration filter is active.
- Planner views: no cell under 5 stories ("dato insufficiente").
- Real citizens' data never in dev/demo: synthetic fixtures only.
- The decision model is advisory; the human decides.

## Deploy

Vercel project `city-life-telling` (framework: Vite, static). Deploy comes from
this repository's `main`:

```bash
npx vercel link --yes --project city-life-telling
npx vercel deploy --prod
```

No environment variables are required. Never deploy the MUSI—CO suite or any
other project from this directory.
