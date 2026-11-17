# Token Radar — pre-token protocols ranked by implied value

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Janetide/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Janetide/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Entry for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01)
("Build the best token launch radar", $1,325, deadline 2026-12-14).

## What it does

Reads the sealed DefiLlama snapshot (`/input/snapshot.json`, as of 2026-11-14) and
ranks 226 pre-token protocols — the whole 40-protocol watchlist plus 186 more below
the $50M floor — by an implied token value priced off the 90 tokens that already
trade. Rank 1 is Steakhouse Financial at about $100.5M.

## The model (radar-2)

`implied = round( tvl × multiple × sizeAdj × growthMult × maturityMult × chainMult )`

- **multiple**: the category median of mcap/TVL over the comparables, shrunk toward
  the global median (0.169) with 5 pseudo-observations — thin categories are mostly
  the global median, and the page says so per row.
- **sizeAdj**: from the log–log fit of mcap on TVL over the comparables (slope 0.55),
  clamped to [0.20, 2.00] — large protocols pay a smaller multiple, as the comps do.
- **growthMult / maturityMult / chainMult**: 7-day TVL growth (clamped, weight 0.5),
  age with no token (0.6–1.0), and chain diversity (up to 1.20).

Validation is computed from the snapshot at build time: leave-one-out on the
comparables (median |log error| 1.03, 33% within 2×) and a seeded 200-refit
bootstrap that gives every row an implied-value range and a rank range. The model
is a ranking device, not a price predictor, and the dashboard says so.

Every row also carries a 7-step farm plan with costs netted to the dollar
(setup + weekly actions + claim at the chain's assumed gas; capital is locked,
not spent) and a FARM / THIN / SKIP verdict. No airdrop percentage or farmer
count is invented: the snapshot carries neither.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. Writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` to the output directory. Deterministic: two
runs write the same bytes.

## Layout

- `main.ts` — entry point; reads the snapshot, writes the board and the dossier.
- `lib/model.ts` — the radar-2 model, farm plans, validation, board builder.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`, no network).
  The model and the farm logic are mirrored in `app.js`, so the page recomputes
  every row it shows.
- `screenshots/` — board, detail view, filtered view at 1440×900.
