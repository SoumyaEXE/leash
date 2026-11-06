"use client";

import { useEffect, useState } from "react";

let cached: string | null = null;

function makeNoise(size = 200): string {
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(size, size);
  // Darken-only grain: black specks with random alpha, so blacks stay black (ref top centre ≈ rgb(4,2,2))
  // and the reds pick up a fine texture.
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
    img.data[i + 3] = Math.floor(Math.random() * 255);
  }
  ctx.putImageData(img, 0, 0);
  cached = c.toDataURL("image/png");
  return cached;
}

/** Film grain: 8.5% opacity tile, inset −200px, jittered by noiseShift (1.25s steps(5)). */
export function NoiseOverlay({ opacity = 0.085 }: { opacity?: number }) {
  const [url, setUrl] = useState<string>("");
  useEffect(() => setUrl(makeNoise()), []);
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none" style={{ opacity }}>
      <div
        className="absolute animate-noise will-change-transform"
        style={{ inset: "-200px", backgroundImage: url ? `url(${url})` : undefined, backgroundRepeat: "repeat" }}
      />
    </div>
  );
}
