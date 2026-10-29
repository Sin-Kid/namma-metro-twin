// Sanity checks for the timetable engine: run with `npm test`.
import { readFileSync } from "node:fs";
// engine.js is a plain browser script; evaluate it and take its MetroEngine function
const MetroEngine = new Function(readFileSync(new URL("../src/engine.js", import.meta.url), "utf8") + "\nreturn MetroEngine;")();
const DATA = JSON.parse(readFileSync(new URL("../src/data.js", import.meta.url), "utf8").replace(/^[\s\S]*?const DATA = /, "").replace(/;\s*$/, ""));
const E = MetroEngine(DATA);
let fail = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fail++; };
const peak = E.tripsFor("wk").filter(t => E.tripState(t, 9 * 3600)).length;
ok(peak > 40, `weekday 09:00 has ${peak} trains running`);
ok(E.tripsFor("wk").filter(t => E.tripState(t, 4 * 3600)).length === 0, "no trains at 04:00 on a weekday");
const purple = E.byColor.purple;
ok(purple.endToEnd / 60 > 70 && purple.endToEnd / 60 < 95, `Purple Line end to end ${Math.round(purple.endToEnd / 60)} min`);
const f = n => E.feats.find(x => x.name === n);
const plan = E.plan(f("Whitefield"), f("Silk Institute"), "wk", 14 * 3600);
ok(plan && plan.length === 2, "Whitefield to Silk Institute needs one change");
process.exit(fail ? 1 : 0);
