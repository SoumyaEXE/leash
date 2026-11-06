/**
 * An independent borsh codec driven only by the IDL that `anchor build` produced (src/idl/leash.json). The tests
 * encode with this and decode with the SDK's hand-written layouts (and the other way round), so a field the SDK
 * forgot, reordered or typed wrongly shows up as a mismatch.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Writer } from "../../src/borsh";

export type IdlType =
  | string
  | { array: [IdlType, number] }
  | { option: IdlType }
  | { vec: IdlType }
  | { defined: { name: string } };

export interface IdlField {
  name: string;
  type: IdlType;
}
export interface IdlTypeDef {
  name: string;
  type: { kind: "struct"; fields: IdlField[] } | { kind: "enum"; variants: { name: string }[] };
}
export interface IdlAccountMeta {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
}
export interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: IdlAccountMeta[];
  args: IdlField[];
}
export interface Idl {
  address: string;
  instructions: IdlInstruction[];
  accounts: { name: string; discriminator: number[] }[];
  events: { name: string; discriminator: number[] }[];
  errors: { code: number; name: string; msg?: string }[];
  types: IdlTypeDef[];
}

export const idl: Idl = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../src/idl/leash.json"), "utf8"));

export const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function typeDef(name: string): IdlTypeDef {
  const t = idl.types.find((x) => x.name === name);
  if (!t) throw new Error(`IDL has no type ${name}`);
  return t;
}

export function fields(name: string): IdlField[] {
  const t = typeDef(name).type;
  if (t.kind !== "struct") throw new Error(`${name} is not a struct`);
  return t.fields;
}

/** Byte size of a fixed-size IDL type (no strings / vecs / options). */
export function fixedSize(type: IdlType): number {
  if (typeof type === "string") {
    const sizes: Record<string, number> = { u8: 1, i8: 1, bool: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, pubkey: 32 };
    if (!(type in sizes)) throw new Error(`not fixed: ${type}`);
    return sizes[type];
  }
  if ("array" in type) return fixedSize(type.array[0]) * type.array[1];
  if ("defined" in type) {
    const t = typeDef(type.defined.name).type;
    if (t.kind === "enum") return 1;
    return t.fields.reduce((s, f) => s + fixedSize(f.type), 0);
  }
  throw new Error(`not fixed: ${JSON.stringify(type)}`);
}

// ── values in "IDL form": integers are bigint, pubkeys PublicKey, [u8; N] Uint8Array, structs snake_case,
//    enums { variant: index } ──

export function encode(w: Writer, type: IdlType, v: unknown): Writer {
  if (typeof type === "string") {
    switch (type) {
      case "u8":
        return w.u8(Number(v));
      case "u16":
        return w.u16(Number(v));
      case "u32":
        return w.u32(Number(v));
      case "u64":
        return w.u64(v as bigint);
      case "i64":
        return w.i64(v as bigint);
      case "bool":
        return w.bool(v as boolean);
      case "pubkey":
        return w.pubkey(v as PublicKey);
      case "string":
        return w.string(v as string);
      default:
        throw new Error(`encode: unsupported ${type}`);
    }
  }
  if ("array" in type) {
    const [inner, n] = type.array;
    if (inner === "u8") return w.fixed(v as Uint8Array, n);
    for (const x of v as unknown[]) encode(w, inner, x);
    return w;
  }
  if ("option" in type) return v === null ? w.u8(0) : encode(w.u8(1), type.option, v);
  if ("vec" in type) {
    const xs = v as unknown[];
    w.u32(xs.length);
    for (const x of xs) encode(w, type.vec, x);
    return w;
  }
  const t = typeDef(type.defined.name).type;
  if (t.kind === "enum") return w.u8((v as { variant: number }).variant);
  for (const f of t.fields) encode(w, f.type, (v as Record<string, unknown>)[f.name]);
  return w;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const bytes = (n: number) => Uint8Array.from({ length: n }, () => int(256));
  return { next, int, bytes };
}
export type Rng = ReturnType<typeof rng>;

const PRINTABLE = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join("");

export function randomString(r: Rng, min: number, max: number): string {
  const len = min + r.int(max - min + 1);
  return Array.from({ length: len }, () => PRINTABLE[r.int(PRINTABLE.length)]).join("");
}

/** A random value of `type`. i64 stays within ±2^50 (the SDK turns timestamps into JS numbers). */
export function random(type: IdlType, r: Rng, fieldName = ""): unknown {
  if (typeof type === "string") {
    switch (type) {
      case "u8":
        return r.int(256);
      case "u16":
        return r.int(65536);
      case "u32":
        return r.int(2 ** 32);
      case "u64":
        return Buffer.from(r.bytes(8)).readBigUInt64LE(0);
      case "i64":
        return BigInt(Math.floor((r.next() - 0.5) * 2 ** 51));
      case "bool":
        return r.int(2) === 1;
      case "pubkey":
        return new PublicKey(r.bytes(32));
      case "string":
        return fieldName === "label" ? randomString(r, 0, 32) : randomString(r, 1, 100);
      default:
        throw new Error(`random: unsupported ${type}`);
    }
  }
  if ("array" in type) {
    const [inner, n] = type.array;
    if (inner === "u8") return r.bytes(n);
    return Array.from({ length: n }, () => random(inner, r, fieldName));
  }
  if ("option" in type) return r.int(2) ? random(type.option, r, fieldName) : null;
  if ("vec" in type) return Array.from({ length: r.int(4) }, () => random(type.vec, r, fieldName));
  const t = typeDef(type.defined.name).type;
  if (t.kind === "enum") return { variant: r.int(t.variants.length) };
  return Object.fromEntries(t.fields.map((f) => [f.name, random(f.type, r, f.name)]));
}

/**
 * Canonical JSON-able form, so an IDL-form value and an SDK-form value (camelCase keys, numbers for timestamps,
 * enum names as lowercase strings) compare equal when they hold the same data.
 */
export function canon(type: IdlType, v: unknown, sdkForm: boolean, omit: readonly string[] = []): unknown {
  if (v === undefined) return "<missing>";
  if (typeof type === "string") {
    switch (type) {
      case "u8":
      case "u16":
      case "u32":
      case "u64":
      case "i64":
        return `n:${BigInt(v as number | bigint)}`;
      case "bool":
        return `b:${v}`;
      case "pubkey":
        return `pk:${(v as PublicKey).toBase58()}`;
      case "string":
        return `s:${v}`;
    }
    throw new Error(`canon: ${type}`);
  }
  if ("array" in type) {
    if (type.array[0] === "u8") return `hex:${Buffer.from(v as Uint8Array).toString("hex")}`;
    return (v as unknown[]).map((x) => canon(type.array[0], x, sdkForm));
  }
  if ("option" in type) return v === null ? null : canon(type.option, v, sdkForm);
  if ("vec" in type) return (v as unknown[]).map((x) => canon(type.vec, x, sdkForm));
  const t = typeDef(type.defined.name).type;
  if (t.kind === "enum") {
    if (!sdkForm) return `e:${(v as { variant: number }).variant}`;
    const i = t.variants.findIndex((x) => x.name.toLowerCase() === String(v).toLowerCase());
    return `e:${i}`;
  }
  const obj = v as Record<string, unknown>;
  return Object.fromEntries(
    t.fields.filter((f) => !omit.includes(f.name)).map((f) => [f.name, canon(f.type, obj[sdkForm ? camel(f.name) : f.name], sdkForm)]),
  );
}

/** IDL-form value → the shape the SDK's builders take (camelCase keys, i64 → number, enums untouched). */
export function toSdk(type: IdlType, v: unknown): unknown {
  if (typeof type === "string") {
    if (type === "i64") return Number(v as bigint);
    if (type === "u8" || type === "u16" || type === "u32") return Number(v);
    return v;
  }
  if ("array" in type) return type.array[0] === "u8" ? v : (v as unknown[]).map((x) => toSdk(type.array[0], x));
  if ("option" in type) return v === null ? null : toSdk(type.option, v);
  if ("vec" in type) return (v as unknown[]).map((x) => toSdk(type.vec, x));
  const t = typeDef(type.defined.name).type;
  if (t.kind === "enum") return v;
  return Object.fromEntries(t.fields.map((f) => [camel(f.name), toSdk(f.type, (v as Record<string, unknown>)[f.name])]));
}

export function discBytes(d: number[]): Uint8Array {
  return Uint8Array.from(d);
}

/** Full account data: discriminator + IDL-encoded struct. */
export function accountData(name: string, value: Record<string, unknown>): Buffer {
  const acc = idl.accounts.find((a) => a.name === name);
  if (!acc) throw new Error(`IDL has no account ${name}`);
  return Buffer.from(encode(new Writer().raw(discBytes(acc.discriminator)), { defined: { name } }, value).bytes());
}

/** `Program data:` payload of an event: discriminator + IDL-encoded fields. */
export function eventData(name: string, value: Record<string, unknown>): string {
  const ev = idl.events.find((a) => a.name === name);
  if (!ev) throw new Error(`IDL has no event ${name}`);
  return Buffer.from(encode(new Writer().raw(discBytes(ev.discriminator)), { defined: { name } }, value).bytes()).toString("base64");
}
