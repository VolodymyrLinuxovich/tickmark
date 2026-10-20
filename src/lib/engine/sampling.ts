// Monetary unit sampling (probability proportional to size), as used in audit
// substantive testing. Items at or above the sampling interval are always
// selected; the rest are picked by a systematic walk from a seeded random start.

export interface SampleItem {
  id: string;
  amount: number; // positive, any unit
}

export interface MusResult {
  interval: number;
  start: number;
  selected: string[];
  topStratum: string[];
}

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
