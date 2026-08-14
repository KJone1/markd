import { createStaticHandler } from "../desktop/server.ts";

Deno.test("desktop handler serves only normalized frontend assets", async () => {
  const requested: string[] = [];
  const handler = createStaticHandler((path) => {
    requested.push(path);
    if (path === "index.html") {
      return Promise.resolve(
        new TextEncoder().encode("<!doctype html><title>Markd</title>"),
      );
    }
    return Promise.reject(new Deno.errors.NotFound());
  });

  const response = await handler(new Request("http://markd.local/"));
  if (
    response.status !== 200 ||
    !response.headers.get("content-type")?.includes("text/html")
  ) {
    throw new Error("The shell document was not served as HTML");
  }
  if (requested.join(",") !== "index.html") {
    throw new Error(`Unexpected asset request: ${requested.join(",")}`);
  }

  for (
    const path of [
      "/assets/%2e%2e%2fsecret",
      "/assets%5csecret",
      "/assets%00secret",
      "/assets%ZZsecret",
    ]
  ) {
    const blocked = await handler(new Request(`http://markd.local${path}`));
    if (blocked.status !== 400) {
      throw new Error(`Unsafe path was not blocked: ${path}`);
    }
  }
});

Deno.test("desktop handler does not allow renderer writes", async () => {
  const handler = createStaticHandler(() => Promise.resolve(new Uint8Array()));
  const response = await handler(
    new Request("http://markd.local/", { method: "POST" }),
  );

  if (
    response.status !== 405 || response.headers.get("allow") !== "GET, HEAD"
  ) {
    throw new Error("Non-read renderer request was not rejected");
  }
});
