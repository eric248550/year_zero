import { describe, expect, it } from "vitest";
import { createWorld, runHeadless, stepWorld } from "@genesis/simulation";
import { seedContent } from "./helpers";

const CJK = /[一-鿿]/;

describe("world language", () => {
  it("new worlds are Traditional Chinese by default", () => {
    const w = createWorld({ seed: 1 });
    expect(w.locale).toBe("zh-TW");
    expect(w.settlements[0]!.name).toBe("深港地堡");
    expect(w.characters[0]!.lifeEvents[0]!.text).toBe("生於深港地堡（第七號避難所）");
  });

  it("engine-written history in a Chinese world is Chinese", () => {
    const r = runHeadless({ seed: 5, ticks: 60, events: seedContent.events });
    const system = r.history.filter((e) => e.kind === "system");
    expect(system.length).toBeGreaterThan(10);
    for (const e of system) expect(e.title, e.title).toMatch(CJK);
    for (const e of r.history.filter((e) => e.kind === "narrative")) expect(e.title, e.title).toMatch(CJK);
  });

  it("English worlds, and worlds from before locales existed, keep English text", () => {
    const en = createWorld({ seed: 1, locale: "en" });
    expect(en.settlements[0]!.name).toBe("Haven Deep");
    const legacy = structuredClone(en);
    delete legacy.locale;
    const a = stepWorld(en, { events: [] });
    const b = stepWorld(legacy, { events: [] });
    expect(a.events.map((e) => e.title)).toEqual(b.events.map((e) => e.title));
    for (const e of b.events) expect(e.title).not.toMatch(CJK);
  });
});
