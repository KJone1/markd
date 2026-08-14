function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((part) =>
    channel(parseInt(part, 16))
  );
  if (!channels || channels.length !== 3) {
    throw new Error(`Unsupported color: ${hex}`);
  }
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

Deno.test("primary action colors meet the design system contrast requirement", async () => {
  const stylesheet = await Deno.readTextFile("src/styles.css");
  const action = stylesheet.match(/\.primary-action\s*\{([^}]+)\}/)?.[1];
  const backgroundToken = action?.match(/background:\s*var\((--[a-z-]+)\)/)
    ?.[1];
  const escapedToken = backgroundToken?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const background = escapedToken
    ? stylesheet.match(new RegExp(`${escapedToken}:\\s*(#[a-f\\d]{6})`, "i"))
      ?.[1]
    : undefined;
  const foreground = action?.match(/color:\s*(#[a-f\d]{6})/i)?.[1] ??
    (action?.match(/color:\s*white\b/i) ? "#ffffff" : undefined);

  if (!background || !foreground) {
    throw new Error("Could not resolve primary action colors from styles.css");
  }

  const ratio = contrast(foreground, background);
  if (ratio < 4.5) {
    throw new Error(
      `Primary action contrast ${ratio.toFixed(2)}:1 is below 4.5:1`,
    );
  }
});
