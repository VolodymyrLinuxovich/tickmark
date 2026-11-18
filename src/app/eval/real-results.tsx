// What we measured outside the planted company: the request reader on five public audit request lists,
// and the full run on Ramp's sandbox. Numbers come from docs/real-lists.md and the README's "How we tested".

const LISTS: { name: string; who: string; requests: number }[] = [
  { name: "UC Hastings year-end PBC list", who: "Written by the college's external auditor", requests: 131 },
  { name: "Buncombe County sample PBC list", who: "County audit RFP", requests: 171 },
  { name: "Typical PBC list, Dec 31 year end", who: "NAIHC training manual", requests: 33 },
  { name: "Purchasing card agreed-upon procedures", who: "South Carolina procurement office", requests: 9 },
  { name: "Items staff prepare for the auditor", who: "Town of Holly Springs audit RFP", requests: 31 },
];

export function RealResults() {
  const total = LISTS.reduce((s, l) => s + l.requests, 0);
  return (
    <>
      <div className="label" style={{ marginTop: 28 }}>On five real audit request lists</div>
      <p className="muted" style={{ marginTop: 0 }}>
        Lists posted publicly by auditors, counties and a state office, scored against answers we wrote by hand.
      </p>
      <div className="card stats">
        <div className="stat"><div className="k">Requests found</div><div className="v" style={{ color: "var(--tick)" }}>{total}/{total}</div><div className="s">across all five lists</div></div>
        <div className="stat"><div className="k">Typed right</div><div className="v">95.7%</div><div className="s">359 of {total} got the right check</div></div>
        <div className="stat"><div className="k">Time per list</div><div className="v">2 s</div><div className="s">keyword rules, no model</div></div>
        <div className="stat"><div className="k">General AI model</div><div className="v">364/{total}</div><div className="s">14 to 33 s per list</div></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>List</th><th>Posted by</th><th style={{ textAlign: "right" }}>Requests</th><th style={{ textAlign: "right" }}>Found</th></tr>
          </thead>
          <tbody>
            {LISTS.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td className="muted">{l.who}</td>
                <td style={{ textAlign: "right" }}>{l.requests}</td>
                <td style={{ textAlign: "right", color: "var(--tick)" }}>✓ {l.requests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Not a blind score: we fixed the keyword rules after looking at these lists. They also add extra rows, mostly sub-items split into their own request, which the plan screen lets you remove. Sources and scoring are in{" "}
        <a href="https://github.com/VolodymyrLinuxovich/tickmark/blob/main/docs/real-lists.md">docs/real-lists.md</a>.
      </p>

      <div className="label" style={{ marginTop: 28 }}>On Ramp&rsquo;s sandbox</div>
      <div className="card stats">
        <div className="stat"><div className="k">Requests answered</div><div className="v" style={{ color: "var(--tick)" }}>7/9</div><div className="s">bank recs and fixed assets are outside Ramp</div></div>
        <div className="stat"><div className="k">First run</div><div className="v">4.7 s</div><div className="s">0.9 s after that</div></div>
        <div className="stat"><div className="k">Records checked</div><div className="v">Every one</div><div className="s">not a sample</div></div>
        <div className="stat"><div className="k">Receipts matched</div><div className="v">186/186</div><div className="s">0 wrong, demo inbox</div></div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Measured on Nov 16, 2026 with the sample list on Ramp&rsquo;s demo business. The receipt emails are generated for the demo.
      </p>
    </>
  );
}
