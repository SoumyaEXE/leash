"use client";

import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

const VERT = /* glsl */ `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

// Leash aurora: a slow red field with a dark sweeping wave and a hot corner glow. Written for this project.
const FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform float uTime;
uniform float uIntro;      // 0 → 1 over the first ~3s
uniform vec2 uResolution;
uniform vec3 uDeep;        // mid red
uniform vec3 uBase;        // background
uniform vec3 uGlow;        // corner glow
uniform float uIntensity;
out vec4 fragColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;          // (0,0) bottom-left
  float t = uTime * 0.07;

  // red body (calibrated to the reference: low centre ≈ rgb(110,13,29), mid ≈ rgb(79,9,20))
  float lower = smoothstep(1.0, 0.0, uv.y);
  float centreX = smoothstep(0.75, 0.0, abs(uv.x - 0.52));
  float drift = fbm(vec2(uv.x * 1.4 + t, uv.y * 0.9 - t * 0.6));
  float body = clamp((0.45 + 0.55 * lower) * (0.28 + 0.72 * centreX) * (0.85 + 0.3 * drift), 0.0, 1.0);
  vec3 col = mix(uBase, uDeep, body);

  // the dark funnel: black at the top centre narrowing down toward the middle (ref top centre ≈ rgb(4,2,2))
  float funnelW = mix(0.10, 0.36, smoothstep(0.35, 1.0, uv.y)) + 0.05 * sin(t * 1.7 + uv.y * 3.0);
  float funnel = smoothstep(funnelW, funnelW * 0.25, abs(uv.x - 0.5 - 0.04 * sin(t + uv.y * 2.0))) * smoothstep(0.30, 0.75, uv.y);
  // a soft dark sweep arcing across the left half
  float wave = 0.46 + 0.14 * sin(uv.x * 2.6 - 0.9 + t * 1.3) + 0.08 * (fbm(vec2(uv.x * 2.2 - t, t * 0.4)) - 0.5);
  float band = exp(-pow((uv.y - wave) * 4.0, 2.0)) * smoothstep(0.65, 0.2, uv.x);
  col = mix(col, uBase, clamp(funnel * 0.97 + band * 0.45, 0.0, 0.97));

  // hot corner glow top-left (ref ≈ rgb(170,21,45)) and a right-edge falloff (ref ≈ rgb(41,4,11))
  float corner = exp(-length((uv - vec2(0.0, 1.0)) * vec2(1.35, 1.6)) * 3.4);
  col += uGlow * corner * 0.9;
  col = mix(col, uBase, smoothstep(0.58, 1.0, uv.x) * 0.55);

  // intro: the palette settles over the first ~3s (ref uPaletteMix 0 → 1)
  col *= mix(0.82, 1.0, uIntro) * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

function hex(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function Aurora({
  deep = "#780f20",
  base = "#050303",
  glow = "#e0234e",
  intensity = 1,
  speed = 1,
  className = "",
}: {
  deep?: string;
  base?: string;
  glow?: string;
  intensity?: number;
  speed?: number;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: Renderer;
    try {
      renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio, 1.5), alpha: false, antialias: false, webgl: 2 });
    } catch {
      return; // no WebGL: the CSS gradient underneath stays visible
    }
    const gl = renderer.gl;
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    gl.canvas.style.display = "block";
    el.appendChild(gl.canvas);

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uIntro: { value: 0 },
        uResolution: { value: [1, 1] },
        uDeep: { value: hex(deep) },
        uBase: { value: hex(base) },
        uGlow: { value: hex(glow) },
        uIntensity: { value: intensity },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height));
      program.uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      const s = (t - t0) / 1000;
      program.uniforms.uTime.value = reduce ? 4 : s * speed + 1;
      // palette mix 0 → 1 over ~3s, ease-out (spec: uPaletteMix)
      const p = Math.min(1, s / 3);
      program.uniforms.uIntro.value = 1 - Math.pow(1 - p, 3);
      renderer.render({ scene: mesh });
      if (!reduce) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [deep, base, glow, intensity, speed]);

  return <div ref={host} aria-hidden className={`absolute inset-0 pointer-events-none ${className}`} />;
}
