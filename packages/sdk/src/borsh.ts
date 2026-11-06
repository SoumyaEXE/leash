import { PublicKey } from "@solana/web3.js";

/** Minimal borsh writer: just the types the Leash program uses. */
export class Writer {
  private chunks: number[] = [];

  u8(v: number): this {
    this.chunks.push(v & 0xff);
    return this;
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u16(v: number): this {
    this.chunks.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }
  u32(v: number): this {
    for (let i = 0; i < 4; i++) this.chunks.push((v >>> (8 * i)) & 0xff);
    return this;
  }
  u64(v: bigint | number): this {
    let x = BigInt(v);
    if (x < 0n) throw new Error("u64 must be >= 0");
    for (let i = 0; i < 8; i++) {
      this.chunks.push(Number(x & 0xffn));
      x >>= 8n;
    }
    return this;
  }
  i64(v: bigint | number): this {
    const x = BigInt.asUintN(64, BigInt(v));
    return this.u64(x);
  }
  fixed(bytes: Uint8Array, len: number): this {
    if (bytes.length !== len) throw new Error(`expected ${len} bytes, got ${bytes.length}`);
    for (const b of bytes) this.chunks.push(b);
    return this;
  }
  pubkey(pk: PublicKey): this {
    return this.fixed(pk.toBytes(), 32);
  }
  string(s: string): this {
    const bytes = new TextEncoder().encode(s);
    this.u32(bytes.length);
    for (const b of bytes) this.chunks.push(b);
    return this;
  }
  optionFixed(bytes: Uint8Array | null | undefined, len: number): this {
    if (!bytes) return this.u8(0);
    this.u8(1);
    return this.fixed(bytes, len);
  }
  raw(bytes: Uint8Array): this {
    for (const b of bytes) this.chunks.push(b);
    return this;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/** Minimal borsh reader. */
export class Reader {
  private o = 0;
  constructor(private readonly buf: Uint8Array) {}

  get offset(): number {
    return this.o;
  }
  skip(n: number): this {
    this.o += n;
    return this;
  }
  private need(n: number) {
    if (this.o + n > this.buf.length) throw new Error("borsh: read past end");
  }
  u8(): number {
    this.need(1);
    return this.buf[this.o++];
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u16(): number {
    this.need(2);
    const v = this.buf[this.o] | (this.buf[this.o + 1] << 8);
    this.o += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    let v = 0;
    for (let i = 3; i >= 0; i--) v = v * 256 + this.buf[this.o + i];
    this.o += 4;
    return v;
  }
  u64(): bigint {
    this.need(8);
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(this.buf[this.o + i]);
    this.o += 8;
    return v;
  }
  i64(): bigint {
    return BigInt.asIntN(64, this.u64());
  }
  fixed(len: number): Uint8Array {
    this.need(len);
    const out = this.buf.slice(this.o, this.o + len);
    this.o += len;
    return out;
  }
  pubkey(): PublicKey {
    return new PublicKey(this.fixed(32));
  }
  string(): string {
    const len = this.u32();
    return new TextDecoder().decode(this.fixed(len));
  }
  optionFixed(len: number): Uint8Array | null {
    return this.u8() === 0 ? null : this.fixed(len);
  }
}
