import { expect, it } from "vitest";
import { fill, formWithButton, Visitor } from "./visitor.ts";

// The lecturer's page belongs to lectures. A tutorial has its own room, for the
// tutor and the students alike, so its /teach address leads there.
const tag = (): string => Math.random().toString(36).slice(2, 8);

it("sends anyone opening a tutorial's lecturer page to the tutorial room", async () => {
  const host = new Visitor();
  const home = await host.open("/");
  const form = formWithButton(home, /^start a session$/i);
  fill(form, `Tutorial ${tag()}`);
  form.querySelector<HTMLSelectElement>('select[name="mode"]')!.value = "tutorial";
  const room = await host.submit(home, form);
  const path = room.url.pathname;
  for (const who of [host, new Visitor()]) {
    const page = await who.open(`${path}/teach`);
    expect(page.status).toBe(200);
    expect(page.url.pathname).toBe(path);
    expect(page.doc.querySelector("form button")?.textContent ?? "", "the tutorial room, not the lecturer's page").not.toMatch(/^Start class$/);
    expect(page.html).toMatch(/Tutorial mode/);
  }
});
