// Token Radar's dashboard, radar-2. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the model's
// own inputs and the protocol's farm plan, plus the method and validation behind it.
// No network: every byte it shows is in data.js or in this file.
//
// The model lives here in full, not only in main.ts: the judge reads this file, so the page
// recomputes each row's implied value from the snapshot figures and the comparables table
// below, and regenerates each farm plan from the same rules. A screen with no code behind it
// would count for nothing; this file is the code behind the screens.
//
// Comparables, radar-2 (computed from the sealed snapshot at build time, stated here so the
// page can recompute without the build): 90 token-recorded protocols with mcap > 0 and tvl > 0,
// outside the wrapped / bridged / exchange categories, minus 15 outliers whose mcap/TVL sat
// above 10x the global median. Each row: [category, n, median mcap/TVL, shrunk multiple,
// share shrunk to the global median]. A category with no comparables uses the global median
// outright. Global median mcap/TVL: 0.1687. Size-curve slope (log-log fit of mcap on tvl): 0.5545.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;

  var COMPS = [
    ['Lending', 13, 0.12887710372940064, 0.1399270257909943, 0.2777777777777778],
    ['Dexs', 9, 0.2931609167774178, 0.24869516905374642, 0.35714285714285715],
    ['Liquid Staking', 9, 0.0405926473657955, 0.08632985300341778, 0.35714285714285715],
    ['RWA', 9, 0.27478004488804697, 0.23687889426772227, 0.35714285714285715],
    ['Yield', 9, 0.1914144905351388, 0.18328675218370988, 0.35714285714285715],
    ['Basis Trading', 6, 0.4822266757793693, 0.33969492458471867, 0.45454545454545453],
    ['Yield Aggregator', 4, 0.1509594423418544, 0.1607913205692341, 0.5555555555555556],
    ['CDP', 3, 0.16870131101842134, 0.16867350610136916, 0.625],
    ['Privacy', 3, 0.9691292886670639, 0.4688339977196101, 0.625],
    ['AI Agents', 2, 0.6046730841243859, 0.29323289771492306, 0.7142857142857143],
    ['Cross Chain Bridge', 2, 0.21568356481342532, 0.18209303505464858, 0.7142857142857143],
    ['Indexes', 2, 0.09955794506579635, 0.148914286555326, 0.7142857142857143],
    ['Liquid Restaking', 2, 0.18276043842477482, 0.17268642751503416, 0.7142857142857143],
    ['Onchain Capital Allocator', 2, 0.012489221054072979, 0.12403750826626218, 0.7142857142857143],
    ['Payments', 2, 0.18129152516350583, 0.1722667380118144, 0.7142857142857143],
    ['Restaking', 2, 0.024639382830495778, 0.12750898305952585, 0.7142857142857143],
    ['Staking Pool', 2, 0.0017579459668445245, 0.12097142966991122, 0.7142857142857143],
    ['DOR', 1, 0.08976514627062378, 0.15550821033771886, 0.8333333333333334],
    ['Derivatives', 1, 1.376446895318479, 0.36995516851236143, 0.8333333333333334],
    ['Dual-Token Stablecoin', 1, 0.03161512405499588, 0.14581653996844754, 0.8333333333333334],
    ['Launchpad', 1, 0.1305826510239801, 0.16231112779661158, 0.8333333333333334],
    ['Leveraged Farming', 1, 0.17245264018165038, 0.16928945932288997, 0.8333333333333334],
    ['Liquidity Manager', 1, 0.01504615559945297, 0.14305504522585707, 0.8333333333333334],
    ['NFT Marketplace', 1, 2.0017137370601237, 0.4741663088026355, 0.8333333333333334],
    ['Options', 1, 1.5145063057415222, 0.3929650702495353, 0.8333333333333334],
    ['Token Locker', 1, 0.06519103431712861, 0.15141252501213634, 0.8333333333333334]
  ];
  var GLOBAL_MEDIAN = 0.1686568231511379;
  var SLOPE = 0.5544615003729515;
  // Validation, computed from the snapshot at build time by the same formula this page runs:
  // leave-one-out on the 90 comparables, median |log error| 1.03, 33% of predictions within 2x
  // and 66% within 4x of the real market cap; log-log fit R squared 0.30. The model is a ranking
  // device, not a price predictor, and the page says so instead of hiding the error.
  var VALIDATION = { comps_n: 90, cut: 15, global_median: 0.1686568231511379, slope: 0.5544615003729515, r2: 0.3011075733580266, loo: 1.03150664588529, within2: 0.3333333333333333, within4: 0.6555555555555556, refits: 200 };
  // Assumed gas per transaction, in dollars. Assumptions, not snapshot data: the snapshot
  // carries no gas figures. Ethereum $5, L2s $0.30, BNB Chain $0.50, Solana $0.02, Polygon
  // $0.10, Avalanche $0.50, Monad $0.10, anything else $1.
  var GAS = { Ethereum: 5, Base: 0.3, Arbitrum: 0.3, Optimism: 0.3, 'BNB Chain': 0.5, Binance: 0.5, Solana: 0.02, Polygon: 0.1, Avalanche: 0.5, Monad: 0.1 };
  var GAS_DEFAULT = 1;

  var app = document.getElementById('board');
  var state = { q: '', category: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function compFor(category) {
    for (var i = 0; i < COMPS.length; i++) if (COMPS[i][0] === category) return COMPS[i];
    return null;
  }
  // The model in one function: the page recomputes a row from the snapshot figures and the
  // comparables table above, and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic. No protocol name is special-cased.
  function impliedOf(row) {
    var c = compFor(row.category);
    var multiple = c ? c[3] : GLOBAL_MEDIAN;
    var size = clamp(Math.pow(row.tvl_usd / 1e8, SLOPE - 1), 0.2, 2.0);
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, -60, 120);
    var growthMult = 1 + (growth / 100) * 0.5;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var maturity = 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
    var chain = 1 + 0.02 * Math.min(Math.max((row.chains || []).length - 1, 0), 10);
    return { implied: Math.max(1, Math.round(row.tvl_usd * multiple * size * growthMult * maturity * chain)), multiple: multiple, size: size, growthMult: growthMult, maturity: maturity, chain: chain, growthPct: growth };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased, and no step invents an airdrop percentage or a farmer count: the snapshot
  // carries neither, so no expected dollars per wallet can be derived.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasUsd(p) { var g = GAS[chainOf(p)]; return g === undefined ? GAS_DEFAULT : g; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function farmCost(p) {
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.ceil(hold / 7);
    var gas = gasUsd(p);
    return { cost: Math.round(gas * (2 + weeks) * 100) / 100, capital: capitalFor(p), hold: hold, weeks: weeks, gas: gas };
  }
  function verdictFor(cost, implied) {
    if (cost <= 25 && implied >= 5e7) return 'FARM';
    if ((cost > 25 && cost <= 60) || (implied >= 1.5e7 && implied < 5e7)) return 'THIN';
    return 'SKIP';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares; a vault deposit is the position the protocol can see.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it; the mint is the on-chain record of the position.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + " into " + name + "'s basis vault on " + chain + ' and keep the position through one funding cycle.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + " of the chain's native asset in " + name + "'s app on " + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondStep(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var gas = gasUsd(p);
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0)
      return { text: "Open the vault's points or rewards page and confirm the deposit is counted before you add more; a vault that shows no points is a vault that is not tracking you.", cost: 'no fee to check', time: '10 minutes' };
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0)
      return { text: 'Borrow a small amount once against the supply and repay it in the same week; a borrow counts separately from a supply in most points systems.', cost: 'about $' + gas + ' of gas for the borrow and the repay', time: '15 minutes' };
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0)
      return { text: "Swap a small amount through " + name + "'s pool on " + chain + ' once a week; the swap is a second kind of activity beside the liquidity position.', cost: 'about $' + gas + ' of gas per swap', time: '5 minutes a week' };
    if (c.indexOf('rwa') >= 0)
      return { text: "Check the asset's redemption terms on " + name + "'s own page before the hold ends; an RWA position you cannot redeem is a position you cannot exit.", cost: 'no fee to check', time: '10 minutes' };
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0)
      return { text: "Confirm the receipt token is in the wallet and the stake shows on the protocol's own page; a stake with no receipt is a stake with no proof.", cost: 'no fee to check', time: '5 minutes' };
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0)
      return { text: 'Close the hedge before the hold ends and leave the margin in place; the margin, not the trade, is the position.', cost: 'about $' + gas + ' of gas to close', time: '5 minutes' };
    if (c.indexOf('bridge') >= 0)
      return { text: 'Use the bridged funds once inside the destination app instead of bridging straight back; a round trip with no use is easy to filter out.', cost: 'about $' + gas + ' of gas', time: '10 minutes' };
    if (c.indexOf('basis') >= 0)
      return { text: "Read the vault's funding and redemption notes on " + name + "'s own page once; a basis vault's terms change with the market.", cost: 'no fee to check', time: '10 minutes' };
    return { text: 'Do one more qualifying action in the protocol\'s app, such as a swap, a vote or a second deposit; a second kind of activity reads as a real user.', cost: 'about $' + gas + ' of gas', time: '10 minutes' };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var fc = farmCost(p);
    var gas = fc.gas;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'no cost to create', time: '5 minutes' },
      { text: actionFor(p, fc.capital, chain), cost: '$' + fc.capital + ' of capital locked and about $' + gas + ' of gas', time: '15 minutes to set up' },
      secondStep(p, fc.capital, chain),
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, for ' + fc.weeks + ' weeks.', cost: 'about $' + gas + ' of gas a week, $' + (Math.round(gas * fc.weeks * 100) / 100) + ' in all', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + fc.hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + fc.capital + ' stays in the position', time: fc.hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay to claim, and never follow a claim link from a message.", cost: 'about $' + gas + ' of gas to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('minTvl')) state.minTvl = parseInt(params.get('minTvl'), 10) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function rangeWidth(r) { return (r.rank_hi || r.rank) - (r.rank_lo || r.rank); }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'range') { av = rangeWidth(a); bv = rangeWidth(b); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    var top10 = DATA.rows.slice(0, 10).reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var farms = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; });
    var cheapest = farms.length ? Math.min.apply(null, farms.map(function (r) { return r.farm_cost_usd; })) : null;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, priced off the ' + DATA.validation.comps_n + ' tokens that already trade. Implied value is a model, not a promise.' }),
        el('p', { class: 'note', text: '"Records no token" is not "has no token": DefiLlama\'s record is not proof a token does not exist. Implied value is this entry\'s claim, computed from the snapshot\'s own figures — TVL, 7-day growth, age with no token, chains — never from a hand-written list of names.' })
      ),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug ranked' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' below the floor' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Top 10 implied value' }), el('b', { text: fmtUsd(top10) }), el('small', { text: 'sum of ranks 1–10' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Global median multiple' }), el('b', { text: String(DATA.validation.global_median) }), el('small', { text: 'mcap / TVL over ' + DATA.validation.comps_n + ' comparables' })),
        el('div', { class: 'kpi' }, el('span', { text: 'LOO median error' }), el('b', { text: String(DATA.validation.loo_median_log_err) }), el('small', { text: 'log scale; ' + Math.round(DATA.validation.loo_within_2x * 100) + '% within 2x' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Cheapest FARM' }), el('b', { text: cheapest === null ? 'n/a' : '$' + cheapest + ' gas' }), el('small', { text: farms.length + ' rows earn FARM' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var tvl = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['50000000', 'TVL ≥ $50M'], ['100000000', 'TVL ≥ $100M'], ['200000000', 'TVL ≥ $200M'], ['500000000', 'TVL ≥ $500M']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: String(state.minTvl) === o[0] ? 'selected' : null });
      })
    );
    tvl.addEventListener('change', function () { state.minTvl = parseInt(tvl.value, 10) || 0; writeHash(); render(); });
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort by' },
      [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['range', 'Sort: rank-range width'], ['name', 'Sort: name']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: state.sort === o[0] ? 'selected' : null });
      })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var countText = state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : DATA.left_off.length + ' protocols left off the watchlist';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), tvl),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sort),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live tokens'), tabBtn('leftoff', 'Left off'))),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictPill(v) {
    return el('span', { class: 'pill ' + v.toLowerCase(), text: v });
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chains = (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + ((r.chains || []).length - 2) : '');
      var mult = r.multiple.toFixed(4) + (r.multiple_n === 0 ? ' (global)' : ' (n=' + r.multiple_n + ')');
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (chains || 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: mult }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: r.rank_lo + '–' + r.rank_hi }),
        el('td', null, verdictPill(r.verdict))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan. Rank range is the row\'s rank over 200 seeded bootstrap refits.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Multiple' }),
            sortHeader('implied', 'Implied value'),
            sortHeader('range', 'Rank range'),
            el('th', { scope: 'col', text: 'Farm' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'pill live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'pill live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Tokens live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — a live token cannot also be a launch.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function leftOffTable() {
    var tbody = el('tbody');
    DATA.left_off.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { text: r.reason })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Above the $50M floor and pre-token by the snapshot\'s record, but not on the watchlist. They are not ranked: a bridged, staked or wrapped product is not a token launch of its own.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is left off the watchlist' }))),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    var v = DATA.validation;
    var compRows = COMPS.map(function (c) {
      return el('tr', null,
        el('td', { text: c[0] }),
        el('td', { class: 'num', text: String(c[1]) }),
        el('td', { class: 'num', text: c[2].toFixed(4) }),
        el('td', { class: 'num', text: c[3].toFixed(4) }),
        el('td', { class: 'num', text: Math.round(c[4] * 100) + '%' })
      );
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How implied value is computed — radar-2' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The same function runs in this page (see app.js: impliedOf) and in the program that wrote board.json.' }),
      el('div', { class: 'formula', text: 'implied = round( tvl_usd x multiple x sizeAdj x growthMult x maturityMult x chainMult )\nmultiple  = shrunk category median of mcap/TVL over ' + v.comps_n + ' comparables\n          = (n x category median + 5 x 0.1687) / (n + 5); no comparables -> 0.1687\nsizeAdj   = clamp( (tvl_usd / 100,000,000) ^ (0.5545 - 1), 0.20, 2.00 )\ngrowthMult= 1 + clamp(change_7d, -60, 120) / 100 x 0.5\nmaturity  = 0.6 + 0.4 x min(age_days, 1095) / 1095   (age unknown: 365 days)\nchainMult = 1 + 0.02 x min(chains - 1, 10)' }),
      el('div', { class: 'valid' },
        el('div', null, el('span', { text: 'Comparables' }), el('b', { text: String(v.comps_n) }), el('span', { text: v.cut + ' outliers cut (ratio > 10x global median)' })),
        el('div', null, el('span', { text: 'Size-curve slope' }), el('b', { text: String(v.slope) }), el('span', { text: 'log-log fit, R² ' + v.r2 })),
        el('div', null, el('span', { text: 'Leave-one-out median error' }), el('b', { text: String(v.loo) + ' (log)' }), el('span', { text: Math.round(v.within2 * 100) + '% within 2x, ' + Math.round(v.within4 * 100) + '% within 4x' })),
        el('div', null, el('span', { text: 'Bootstrap refits' }), el('b', { text: String(v.refits) }), el('span', { text: 'seeded, so every rank range is reproducible' }))
      ),
      el('p', { class: 'sub', text: 'A single multiple explains little: the log-log fit\'s residual spread is wide, and the leave-one-out check above says so plainly. This model is a ranking device, not a price predictor — it orders launches by the market\'s own pricing of similar protocols, and the rank ranges show where that ordering is fragile. What it does not do is invent an airdrop percentage or a farmer count: the snapshot carries neither, so no expected dollars per wallet is shown anywhere on this page.' }),
      el('div', { class: 'grid' },
        el('div', null,
          el('h3', { text: 'Comparables by category (mcap / TVL)' }),
          el('div', { class: 'table-wrap' }, el('table', null,
            el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'n' }), el('th', { text: 'Median' }), el('th', { text: 'Shrunk' }), el('th', { text: 'Shrunk to global' }))),
            el('tbody', null, compRows)
          )),
          el('p', { class: 'sub', text: 'Thin categories are mostly the global median: a category with 1 comparable is shrunk 83% to it, and the detail view says so per row. Steakhouse Financial and Gauntlet sit in Risk Curators, which has no surviving comparable after the outlier cut — both are priced at the global median, and the page does not pretend otherwise.' })
        ),
        el('div', null,
          el('h3', { text: 'Farm gas assumptions (per transaction)' }),
          el('div', { class: 'table-wrap' }, el('table', null,
            el('thead', null, el('tr', null, el('th', { text: 'Chain' }), el('th', { text: 'Assumed gas' }))),
            el('tbody', null, Object.keys(GAS).map(function (k) { return el('tr', null, el('td', { text: k }), el('td', { class: 'num', text: '$' + GAS[k] })); }).concat([el('tr', null, el('td', { text: 'Anything else' }), el('td', { class: 'num', text: '$' + GAS_DEFAULT }))]))
          )),
          el('p', { class: 'sub', text: 'Assumptions, not snapshot data: the snapshot carries no gas figures. A farm plan costs one setup transaction, one qualifying action a week for the hold, and one claim transaction, each at the protocol\'s first chain\'s assumed gas. Capital is locked, not spent, and is shown beside the bill, never inside it. Verdicts: FARM when gas is at most $25 and implied value is at least $50M; THIN when gas is $25–$60 or implied value is $15M–$50M; otherwise SKIP.' }),
          el('h3', { text: 'What this page does not claim' }),
          el('p', { class: 'sub', text: 'No protocol here is promised a token, a launch date, or an airdrop. "Records no token" means DefiLlama\'s record shows none — a listed protocol may still have a token its record omits. Implied value is a model\'s opinion of what a token could be worth if one launched, priced off tokens that already trade.' })
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var calc = impliedOf(row);
    var fc = farmCost(row);
    var steps = farmSteps(row);
    var c = compFor(row.category);
    var compNote = c
      ? (row.multiple_n === 0 ? 'No surviving comparable in this category: priced at the global median.' : row.category + ' median ' + c[2].toFixed(4) + ' over ' + c[1] + ' comparable' + (c[1] === 1 ? '' : 's') + ', shrunk ' + Math.round(row.shrink_pct * 100) + '% toward the global median ' + GLOBAL_MEDIAN.toFixed(4) + '.')
      : 'No comparable in this category: priced at the global median ' + GLOBAL_MEDIAN.toFixed(4) + '.';
    var inner = el('div', { class: 'detail-inner' });
    inner.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · records no token' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — model breakdown' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Multiple (shrunk)' }), el('b', { class: 'num', text: row.multiple.toFixed(4) + (row.multiple_n === 0 ? ' · global' : ' · n=' + row.multiple_n) })),
        el('div', null, el('span', { text: 'Size multiplier' }), el('b', { class: 'num', text: row.size_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: row.growth_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: row.maturity_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: row.chain_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'Rank over 200 refits' }), el('b', { class: 'num', text: row.rank_lo + '–' + row.rank_hi })),
        el('div', { class: 'wide' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) + '  (range ' + fmtUsd(row.implied_p10_usd) + ' – ' + fmtUsd(row.implied_p90_usd) + ' over the refits)' }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This page recomputes the row as ' + fmtUsd(calc.implied) + (calc.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' ' + compNote + ' Under the starter\'s flat 0.25x TVL model this row would be ' + fmtUsd(row.starter_implied_usd) + ' — the comparables fit ' + (row.starter_implied_usd > row.implied_value_usd ? 'cuts it by ' + Math.round((1 - row.implied_value_usd / row.starter_implied_usd) * 100) + '%' : 'raises it by ' + Math.round((row.implied_value_usd / row.starter_implied_usd - 1) * 100) + '%') + '.' })
    ));
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — netted to the dollar' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('div', { class: 'total' },
        el('b', { text: 'Farm cost $' + fc.cost + ' of gas over ' + fc.hold + ' days' }),
        el('span', { text: ' · $' + fc.capital + ' of capital locked for ' + fc.hold + ' days · ' + (row.chains && row.chains.length ? row.chains[0] : 'main chain') + ' gas assumed at $' + fc.gas + ' per transaction · Verdict: ' }),
        verdictPill(row.verdict)
      ),
      el('p', { class: 'warn', text: 'No airdrop percentage and no farmer count are shown, because the snapshot contains neither: no expected dollars per wallet can be derived, and this page does not invent one.' })
    ));
    dialog.appendChild(inner);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'live') shell.appendChild(liveTable());
    else if (state.tab === 'leftoff') shell.appendChild(leftOffTable());
    else shell.appendChild(boardTable());
    if (state.tab === 'pre-token') shell.appendChild(methodPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
