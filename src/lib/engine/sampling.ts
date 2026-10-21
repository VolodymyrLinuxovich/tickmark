// Engine helper: picks which card transactions to test when the auditor asks
// for a sample instead of naming items.
//
// Monetary unit sampling treats every dollar as a unit and samples dollars, then
// tests the transaction holding each sampled dollar. A $9,000 charge is 100 times
// more likely to be picked than a $90 one. Auditors use it because misstatement risk
// sits in the large amounts, and it gives full coverage of anything material.
// Items at or above the sampling interval are always selected; the rest are
// picked by a systematic walk from a seeded random start.

/** One item in the population. Amount is the weight for selection. */
export interface SampleItem {
  id: string;
  amount: number; // positive, any unit
}

/**
 * interval: dollars between sampled units. start: the random first unit.
 * topStratum: items at or above the interval, which are always tested.
 */
export interface MusResult {
  interval: number;
  start: number;
  selected: string[];
  topStratum: string[];
}

/** Mulberry32, a small seeded PRNG. Seeding makes a sample reproducible, so anyone can re-perform it. */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Selects about n items by systematic monetary unit sampling. Non-positive amounts
 * (refunds) are excluded. If n covers the whole population, everything is selected.
 * The result can hold fewer than n ids when a large item spans several sampled units.
 */
export function monetaryUnitSample(items: SampleItem[], n: number, seed = 1): MusResult {
  const pop = items.filter((i) => i.amount > 0);
  if (n <= 0 || !pop.length) return { interval: 0, start: 0, selected: [], topStratum: [] };
  if (n >= pop.length) return { interval: 0, start: 0, selected: pop.map((i) => i.id), topStratum: [] };

  // Peel off items larger than the interval until the interval is stable.
  let top: SampleItem[] = [];
  let rest = pop;
  let interval = 0;
  for (;;) {
    const remaining = n - top.length;
    const total = rest.reduce((s, i) => s + i.amount, 0);
    interval = remaining > 0 ? total / remaining : Infinity;
    const big = rest.filter((i) => i.amount >= interval);
    if (!big.length || remaining <= 0) break;
    top = [...top, ...big];
    rest = rest.filter((i) => i.amount < interval);
  }
  const remaining = n - top.length;
  const selected = new Set(top.map((i) => i.id));
  const rand = mulberry(seed);
  const start = rand() * interval;
    // Walk the cumulative dollar total; every time it passes the next sampling point
    // (start, start + interval, ...), the item holding that dollar is selected.
  if (remaining > 0 && Number.isFinite(interval)) {
    let cum = 0;
    let k = 0;
    let next = start;
    for (const item of rest) {
      cum += item.amount;
      while (cum > next && k < remaining) {
        selected.add(item.id);
        k++;
        next = start + k * interval;
      }
    }
  }
  return { interval, start, selected: [...selected], topStratum: top.map((i) => i.id) };
}
