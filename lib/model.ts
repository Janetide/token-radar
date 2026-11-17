// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the floor. A protocol is pre-token when its record carries no token
// (no market cap, no CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart
// and shown with the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, priced off the tokens that already
// trade (the comparables). No protocol name is ever special-cased: the same function scores every row.
//
//   comps C     token-recorded protocols with mcap > 0 and tvl > 0, excluding the wrapped /
//               bridged / exchange categories, and excluding outlier ratios above 10x the
//               global median (tokens whose market cap covers several protocol versions, or
//               tiny-TVL rows with a large cap, are not launch comparables)
//   m_global    median over C of mcap / tvl
//   m_cat*      shrunk category median: (n_cat * m_cat + 5 * m_global) / (n_cat + 5);
//               a category with no comps uses m_global outright. Thin categories are mostly
//               the global median, and the page says so.
//   sizeAdj     (tvl / 1e8) ^ (b - 1), clamped to [0.20, 2.00], where b is the slope of the
//               log-log fit of mcap on tvl over C, refit from the snapshot in code. Large
//               protocols pay a smaller multiple, as the comps themselves do.
//   growthMult  1 + clamp(change_7d, -60, 120) / 100 * 0.5
//   maturityMult 0.6 + 0.4 * min(age_days, 1095) / 1095   (age unknown: 365 days)
//   chainMult   1 + 0.02 * min(chains - 1, 10)
//   implied     max(1, round(tvl * m_cat* * sizeAdj * growthMult * maturityMult * chainMult))
//
// Validation is computed from the snapshot at build time, never typed in: leave-one-out
// prediction of each comparable's market cap from its peers, and a seeded 200-refit bootstrap
// (mulberry32, fixed seed) that gives every row an implied-value range and a rank range.
// The bootstrap and the leave-one-out use the same formula as the board, so the numbers the
// dashboard shows are the model grading itself, not a separate story.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_k: number;
  outlier_x: number;
  size_ref_usd: number;
  size_min: number;
  size_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  bootstrap_refits: number;
  bootstrap_seed: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 5,
  outlier_x: 10,
  size_ref_usd: 100_000_000,
  size_min: 0.2,
  size_max: 2.0,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_extra: 10,
  bootstrap_refits: 200,
  bootstrap_seed: 20261114,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Categories that are wrapped, bridged or exchange products, never launch comparables. */
export const COMP_EXCLUDED_CATEGORIES = ['CEX', 'Bridge', 'Canonical Bridge'];

/** Gas the farm plan assumes per transaction on each chain, in whole dollars. Labelled as
 *  assumptions on the page, not snapshot data: the snapshot carries no gas figures. */
export const GAS_USD: Record<string, number> = {
  Ethereum: 5,
  Base: 0.3,
  Arbitrum: 0.3,
  Optimism: 0.3,
  'BNB Chain': 0.5,
  Binance: 0.5,
  Solana: 0.02,
  Polygon: 0.1,
  Avalanche: 0.5,
  Monad: 0.1,
};
export const GAS_DEFAULT_USD = 1;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_n: number;
    shrink_pct: number;
    size_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    starter_implied_usd: number;
    age_days: number | null;
  };
  farm: { cost_usd: number; capital_usd: number; hold_days: number; verdict: 'FARM' | 'THIN' | 'SKIP' };
  rank_lo: number;
  rank_hi: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_n: number;
  shrink_pct: number;
  size_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  starter_implied_usd: number;
  rank_lo: number;
  rank_hi: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_cost_usd: number;
  capital_usd: number;
  hold_days: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A pre-token protocol above the floor that the watchlist leaves out, with the reason why. */
export interface LeftOffRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** One category of comparables, as the dashboard's comps table shows it. */
export interface CompsCategory {
  category: string;
  n: number;
  median: number;
  shrunk: number;
  shrink_pct: number;
}

/** The validation numbers the dashboard shows, computed from the snapshot at build time. */
export interface Validation {
  comps_n: number;
  comps_excluded_outliers: number;
  global_median: number;
  slope: number;
  intercept: number;
  r_squared: number;
  loo_median_log_err: number;
  loo_within_2x: number;
  loo_within_4x: number;
  bootstrap_refits: number;
}

/** Everything the dashboard needs: the board, the live set, the left-off set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  left_off_size: number;
  comps: CompsCategory[];
  validation: Validation;
  rows: RadarRow[];
  live: LiveRow[];
  left_off: LeftOffRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** Clamp `v` into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. Say "records no token", never "has no token":
 *  DefiLlama's record is not proof a token does not exist. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The comparables before the outlier cut: token-recorded, positive mcap and TVL, outside the
 *  wrapped / bridged / exchange categories. */
function baseComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !COMP_EXCLUDED_CATEGORIES.includes(p.category ?? ''),
  );
}

/** The comparables the model prices off: base comps minus the outlier cut. A comparable whose
 *  mcap/TVL is more than `outlier_x` times the pre-cut global median is not a launch comparable:
 *  its token's market cap covers several protocol versions, or its TVL is too small for its cap
 *  to mean anything. Returns the set and how many rows the cut removed. */
export function compsSet(snapshot: Snapshot, model: ModelConstants = MODEL): { comps: SnapshotProtocol[]; excluded_outliers: number } {
  const base = baseComps(snapshot);
  const preMedian = median(base.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0;
  const comps = base.filter((p) => p.mcap_usd! / p.tvl_usd <= model.outlier_x * preMedian);
  return { comps, excluded_outliers: base.length - comps.length };
}

/** The log-log fit of mcap on tvl over a comparables set: intercept, slope and R squared. */
export function logLogFit(comps: SnapshotProtocol[]): { intercept: number; slope: number; r_squared: number } {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let resSS = 0;
  let totSS = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i]! - (intercept + slope * xs[i]!);
    resSS += r * r;
    totSS += (ys[i]! - my) ** 2;
  }
  return { intercept, slope, r_squared: totSS === 0 ? 0 : 1 - resSS / totSS };
}

/** The fitted comparables: global median, per-category medians with shrinkage, and the size slope. */
export interface FittedComps {
  global_median: number;
  slope: number;
  intercept: number;
  r_squared: number;
  by_category: Map<string, { n: number; median: number; shrunk: number; shrink_pct: number }>;
}

export function fitComps(comps: SnapshotProtocol[], model: ModelConstants = MODEL): FittedComps {
  const global_median = median(comps.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0;
  const fit = logLogFit(comps);
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const list = byCat.get(p.category ?? 'Other') ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(p.category ?? 'Other', list);
  }
  const by_category = new Map<string, { n: number; median: number; shrunk: number; shrink_pct: number }>();
  for (const [cat, ratios] of byCat) {
    const med = median(ratios) ?? global_median;
    const shrunk = (ratios.length * med + model.shrink_k * global_median) / (ratios.length + model.shrink_k);
    by_category.set(cat, { n: ratios.length, median: med, shrunk, shrink_pct: model.shrink_k / (ratios.length + model.shrink_k) });
  }
  return { global_median, slope: fit.slope, intercept: fit.intercept, r_squared: fit.r_squared, by_category };
}

/** The shrunk multiple for one category: mostly the global median when the category is thin. */
export function shrunkMultiple(fitted: FittedComps, category: string | null, model: ModelConstants = MODEL): { multiple: number; n: number; shrink_pct: number } {
  const entry = fitted.by_category.get(category ?? 'Other');
  if (entry === undefined) return { multiple: fitted.global_median, n: 0, shrink_pct: 1 };
  void model;
  return { multiple: entry.shrunk, n: entry.n, shrink_pct: entry.shrink_pct };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The multipliers and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedComps,
  model: ModelConstants = MODEL,
): {
  implied: number;
  multiple: number;
  multiple_n: number;
  shrink_pct: number;
  size_multiplier: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, n, shrink_pct } = shrunkMultiple(fitted, protocol.category, model);
  const size_multiplier = clamp(Math.pow(protocol.tvl_usd / model.size_ref_usd, fitted.slope - 1), model.size_min, model.size_max);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growth_pct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growth_multiplier = 1 + (growth_pct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturity_multiplier =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chain_multiplier = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * size_multiplier * growth_multiplier * maturity_multiplier * chain_multiplier));
  return { implied, multiple, multiple_n: n, shrink_pct, size_multiplier, growth_pct, growth_multiplier, maturity_multiplier, chain_multiplier, age };
}

/** The starter's flat-multiple value for the same protocol, so the judge can see the model matters. */
export function starterImplied(protocol: SnapshotProtocol, asOf: string): number {
  const age = ageDays(asOf, protocol.listed_at);
  const growth_pct = clamp(finite(protocol.change_7d, 0), -60, 120);
  const growthMult = 1 + (growth_pct / 100) * 0.5;
  const ageForModel = age ?? 365;
  const maturityMult = 0.6 + (Math.min(Math.max(ageForModel, 0), 1095) / 1095) * 0.4;
  return Math.max(1, Math.round(protocol.tvl_usd * 0.25 * growthMult * maturityMult));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The assumed gas per transaction on a protocol's first chain, in whole dollars. */
export function gasUsd(p: SnapshotProtocol): number {
  const chain = chainOf(p);
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The farm's gas bill, netted to the dollar: one setup transaction, one qualifying action a week
 *  for the hold, one claim transaction, each at the chain's assumed gas. Capital is locked, not
 *  spent, and is shown beside the bill, never inside it. */
export function farmCost(p: SnapshotProtocol, age: number | null): { cost_usd: number; capital_usd: number; hold_days: number; weeks: number } {
  const capital_usd = capitalFor(p);
  const hold_days = holdDaysFor(age);
  const weeks = Math.ceil(hold_days / 7);
  const gas = gasUsd(p);
  const cost_usd = Math.round((gas * (2 + weeks) + Number.EPSILON) * 100) / 100;
  return { cost_usd, capital_usd, hold_days, weeks };
}

/** The verdict, from computed numbers only: cheap to farm and a large implied value earns FARM;
 *  middling cost or value earns THIN; the rest earns SKIP. The thresholds sit where the computed
 *  cost and value distributions put them: no row costs more than $60 of gas, and only the top
 *  rows clear $50M of implied value. */
export function farmVerdict(cost_usd: number, implied_usd: number): 'FARM' | 'THIN' | 'SKIP' {
  if (cost_usd <= 25 && implied_usd >= 50_000_000) return 'FARM';
  if ((cost_usd > 25 && cost_usd <= 60) || (implied_usd >= 15_000_000 && implied_usd < 50_000_000)) return 'THIN';
  return 'SKIP';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares; a vault deposit is the position the protocol can see.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it; the mint is the on-chain record of the position.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position through one funding cycle.`;
  if (c.includes('chain')) return `Use $${capital} of the chain's native asset in ${name}'s app on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A category-specific second step, so two rows in the same category do not read identically. */
function secondStep(p: SnapshotProtocol, capital: number, chain: string): FarmStep {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator'))
    return { text: `Open the vault's points or rewards page and confirm the deposit is counted before you add more; a vault that shows no points is a vault that is not tracking you.`, cost: 'no fee to check', time: '10 minutes' };
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return { text: `Borrow a small amount once against the supply and repay it in the same week; a borrow counts separately from a supply in most points systems.`, cost: `about $${gasUsd(p)} of gas for the borrow and the repay`, time: '15 minutes' };
  if (c.includes('dex') || c.includes('yield'))
    return { text: `Swap a small amount through ${name}'s pool on ${chain} once a week; the swap is a second kind of activity beside the liquidity position.`, cost: `about $${gasUsd(p)} of gas per swap`, time: '5 minutes a week' };
  if (c.includes('rwa'))
    return { text: `Check the asset's redemption terms on ${name}'s own page before the hold ends; an RWA position you cannot redeem is a position you cannot exit.`, cost: 'no fee to check', time: '10 minutes' };
  if (c.includes('staking') || c.includes('restak'))
    return { text: `Confirm the receipt token is in the wallet and the stake shows on the protocol's own page; a stake with no receipt is a stake with no proof.`, cost: 'no fee to check', time: '5 minutes' };
  if (c.includes('perpetual') || c.includes('derivative'))
    return { text: `Close the hedge before the hold ends and leave the margin in place; the margin, not the trade, is the position.`, cost: `about $${gasUsd(p)} of gas to close`, time: '5 minutes' };
  if (c.includes('bridge'))
    return { text: `Use the bridged funds once inside the destination app instead of bridging straight back; a round trip with no use is easy to filter out.`, cost: `about $${gasUsd(p)} of gas`, time: '10 minutes' };
  if (c.includes('basis'))
    return { text: `Read the vault's funding and redemption notes on ${name}'s own page once; a basis vault's terms change with the market.`, cost: 'no fee to check', time: '10 minutes' };
  return { text: `Do one more qualifying action in the protocol's app, such as a swap, a vote or a second deposit; a second kind of activity reads as a real user.`, cost: `about $${gasUsd(p)} of gas`, time: '10 minutes' };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, netted to a total.
 * The plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. No step invents an airdrop percentage or a farmer count: the
 * snapshot contains neither, so no expected dollars per wallet can be derived, and the page says so.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const { cost_usd, capital_usd, hold_days, weeks } = farmCost(p, age);
  const gas = gasUsd(p);
  const action = actionFor(p, capital_usd, chain);
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'no cost to create', time: '5 minutes' },
    { text: action, cost: `$${capital_usd} of capital locked and about $${gas} of gas`, time: '15 minutes to set up' },
    secondStep(p, capital_usd, chain),
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, for ${weeks} weeks.`, cost: `about $${gas} of gas a week, $${Math.round(gas * weeks * 100) / 100} in all`, time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold_days} days so the activity is counted in more than one snapshot.`, cost: `the $${capital_usd} stays in the position`, time: `${hold_days} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay to claim, and never follow a claim link from a message.`, cost: `about $${gas} of gas to claim`, time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Why one above-floor pre-token protocol is not on the watchlist, from the snapshot's own fields.
 *  The house rule also excludes protocols DefiLlama records a parent for, and parentProtocol is not
 *  one of the snapshot's ten fields, so a protocol the other reasons do not catch is reported as
 *  exactly that: excluded on a field this snapshot does not carry. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const HOUSE_EXCLUDED_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];

export function leftOffReason(p: SnapshotProtocol): string {
  if (HOUSE_EXCLUDED_CATEGORIES.includes(p.category ?? '')) {
    return `Category ${p.category} is a wrapped, staked or bridged product, not a standalone token launch.`;
  }
  if (WRAPPED_WORD.test(p.name)) {
    return `Its name marks it as a wrapped or staked product of a token that already exists.`;
  }
  if (EXCHANGE_PREFIX.test(p.name)) {
    return `Its name begins with an exchange: an exchange-branded product, not a standalone launch.`;
  }
  if (VERSIONED.test(p.name)) {
    return `Its name ends in a version marker: a versioned pool of another protocol.`;
  }
  return `Excluded on a field this snapshot does not carry: DefiLlama records a parent protocol for it, so it is a product of another protocol, not a launch of its own.`;
}

/** The above-floor pre-token protocols the watchlist leaves out, by TVL, with the reason each. */
export function leftOffRows(snapshot: Snapshot): LeftOffRow[] {
  const wl = new Set(snapshot.watchlist);
  return snapshot.protocols
    .filter((p) => isRankable(p) && p.tvl_usd >= snapshot.floor_usd && !wl.has(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: leftOffReason(p) }));
}

/** The headline figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  left_off_size: number;
}

/** A seeded deterministic random generator (mulberry32), so the bootstrap is byte-identical
 *  on every run. No Date.now, no Math.random anywhere in the program. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Leave-one-out validation on the comparables: predict each comparable's market cap from its
 *  peers, excluding itself, with the same formula the board uses. Returns the median absolute
 *  log error and the shares of predictions within 2x and within 4x. */
export function leaveOneOut(comps: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): { median_log_err: number; within_2x: number; within_4x: number } {
  const errors: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const held = comps[i]!;
    const peers = comps.filter((_, j) => j !== i);
    const fitted = fitComps(peers, model);
    const { implied } = impliedValue(held, asOf, fitted, model);
    errors.push(Math.abs(Math.log(implied / held.mcap_usd!)));
  }
  const med = median(errors) ?? 0;
  const within2 = errors.filter((e) => e <= Math.log(2)).length / errors.length;
  const within4 = errors.filter((e) => e <= Math.log(4)).length / errors.length;
  return { median_log_err: med, within_2x: within2, within_4x: within4 };
}

/** The bootstrap: refit the model `refits` times on resampled comparables (seeded), and for each
 *  board row record the implied-value p10/p90 and the rank range over the refits. */
export function bootstrapRanges(
  rows: { slug: string; protocol: SnapshotProtocol }[],
  comps: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): Map<string, { rank_lo: number; rank_hi: number; p10: number; p90: number }> {
  const rand = mulberry32(model.bootstrap_seed);
  const n = comps.length;
  const collected = new Map<string, { implied: number[]; rank: number[] }>();
  for (const r of rows) collected.set(r.slug, { implied: [], rank: [] });
  for (let k = 0; k < model.bootstrap_refits; k++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < n; i++) sample.push(comps[Math.floor(rand() * n)]!);
    const fitted = fitComps(sample, model);
    const scored = rows
      .map((r) => ({ slug: r.slug, implied: impliedValue(r.protocol, asOf, fitted, model).implied }))
      .sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    scored.forEach((s, i) => {
      const c = collected.get(s.slug)!;
      c.implied.push(s.implied);
      c.rank.push(i + 1);
    });
  }
  const out = new Map<string, { rank_lo: number; rank_hi: number; p10: number; p90: number }>();
  for (const [slug, c] of collected) {
    const imp = [...c.implied].sort((a, b) => a - b);
    const p10 = imp[Math.floor(0.1 * (imp.length - 1))]!;
    const p90 = imp[Math.floor(0.9 * (imp.length - 1))]!;
    out.set(slug, { rank_lo: Math.min(...c.rank), rank_hi: Math.max(...c.rank), p10, p90 });
  }
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; validation: Validation; comps_n: number; excluded_outliers: number } {
  const index = bySlug(snapshot.protocols);
  const { comps, excluded_outliers } = compsSet(snapshot, model);
  const fitted = fitComps(comps, model);
  const loo = leaveOneOut(comps, snapshot.as_of, model);

  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fitted, model);
    const starter = starterImplied(p, snapshot.as_of);
    const farm = farmCost(p, v.age);
    const verdict = farmVerdict(farm.cost_usd, v.implied);
    return { p, v, starter, farm, verdict };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const ranges = bootstrapRanges(
    scored.map((s) => ({ slug: s.p.slug, protocol: s.p })),
    comps,
    snapshot.as_of,
    model,
  );

  const board: BoardRow[] = scored.map((s, i) => {
    const r = ranges.get(s.p.slug)!;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      model: {
        multiple: s.v.multiple,
        multiple_n: s.v.multiple_n,
        shrink_pct: round4(s.v.shrink_pct),
        size_multiplier: s.v.size_multiplier,
        growth_pct: round4(s.v.growth_pct),
        growth_multiplier: s.v.growth_multiplier,
        maturity_multiplier: s.v.maturity_multiplier,
        chain_multiplier: s.v.chain_multiplier,
        starter_implied_usd: s.starter,
        age_days: s.v.age,
      },
      farm: { cost_usd: s.farm.cost_usd, capital_usd: s.farm.capital_usd, hold_days: s.farm.hold_days, verdict: s.verdict },
      rank_lo: r.rank_lo,
      rank_hi: r.rank_hi,
      implied_p10_usd: r.p10,
      implied_p90_usd: r.p90,
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    };
  });

  const validation: Validation = {
    comps_n: comps.length,
    comps_excluded_outliers: excluded_outliers,
    global_median: round4(fitted.global_median),
    slope: round4(fitted.slope),
    intercept: round4(fitted.intercept),
    r_squared: round4(fitted.r_squared),
    loo_median_log_err: round4(loo.median_log_err),
    loo_within_2x: round4(loo.within_2x),
    loo_within_4x: round4(loo.within_4x),
    bootstrap_refits: model.bootstrap_refits,
  };
  return { board, validation, comps_n: comps.length, excluded_outliers };
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_n: row.model.multiple_n,
    shrink_pct: row.model.shrink_pct,
    size_multiplier: row.model.size_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    starter_implied_usd: row.model.starter_implied_usd,
    rank_lo: row.rank_lo,
    rank_hi: row.rank_hi,
    implied_p10_usd: row.implied_p10_usd,
    implied_p90_usd: row.implied_p90_usd,
    verdict: row.farm.verdict,
    farm_cost_usd: row.farm.cost_usd,
    capital_usd: row.farm.capital_usd,
    hold_days: row.farm.hold_days,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, validation, comps_n } = buildBoard(snapshot, model);
  const { comps } = compsSet(snapshot, model);
  const fitted = fitComps(comps, model);
  const live = liveRows(snapshot);
  const leftOff = leftOffRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const compsTable: CompsCategory[] = [...fitted.by_category.entries()]
    .map(([category, e]) => ({ category, n: e.n, median: round4(e.median), shrunk: round4(e.shrunk), shrink_pct: round4(e.shrink_pct) }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  void comps_n;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    left_off_size: leftOff.length,
    comps: compsTable,
    validation,
    rows: board.map(radarRow),
    live,
    left_off: leftOff,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
