import { describe, expect, it, inject } from "vitest";

// Use it wasn't designed for: every page reads a POST as a form, so a body
// sent another way, or a form that can't be read, is refused with a 400,
// never a 500.
const baseUrl = inject("baseUrl");
const pages = ["/", "/signin", "/signup", "/s/HAND", "/s/HAND/questions", "/s/HAND/timeline"];

async function send(path: string, type: string, body: string): Promise<number> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": type, origin: new URL(baseUrl).origin },
    body,
    redirect: "manual",
  });
  await response.text();
  return response.status;
}

describe("a POST that is not a form", () => {
  it("is refused with a 400 when it is JSON", async () => {
    for (const path of pages) expect(await send(path, "application/json", '{"intent":"ask","body":"hi"}'), path).toBe(400);
  });

  it("is refused with a 400 when it is a form that can't be read", async () => {
    for (const path of pages) expect(await send(path, "multipart/form-data; boundary=x", "--x\r\nnot a part"), path).toBe(400);
  });
});
