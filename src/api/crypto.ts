/* GL.iNet SDK4 登录所需的最小密码学实现（TS 版，逻辑与 glass/js/crypto.js 一致）
 *
 *   challenge(username)      -> { salt, nonce }
 *   passwd   = crypt_sha256(password, salt)          ($5$salt$digest)
 *   hash     = sha256_hex(`${username}:${passwd}:${nonce}`)
 *   login({ username, hash }) -> { sid }
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export function sha256(bytes: Uint8Array): Uint8Array {
  const len = bytes.length
  const total = ((len + 8) >> 6) * 64 + 64
  const withPad = new Uint8Array(total)
  withPad.set(bytes)
  withPad[len] = 0x80
  const bitLen = len * 8
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  withPad[total - 8] = (hi >>> 24) & 0xff
  withPad[total - 7] = (hi >>> 16) & 0xff
  withPad[total - 6] = (hi >>> 8) & 0xff
  withPad[total - 5] = hi & 0xff
  withPad[total - 4] = (lo >>> 24) & 0xff
  withPad[total - 3] = (lo >>> 16) & 0xff
  withPad[total - 2] = (lo >>> 8) & 0xff
  withPad[total - 1] = lo & 0xff

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const W = new Uint32Array(64)

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] =
        (withPad[off + i * 4] << 24) |
        (withPad[off + i * 4 + 1] << 16) |
        (withPad[off + i * 4 + 2] << 8) |
        withPad[off + i * 4 + 3]
    }
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15]
      const y = W[i - 2]
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3]
    let e = H[4], f = H[5], g = H[6], h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0
      d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0
    H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0
    H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
  }

  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >>> 24) & 0xff
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff
    out[i * 4 + 3] = H[i] & 0xff
  }
  return out
}

const enc = new TextEncoder()

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function repeatTo(bytes: Uint8Array, len: number): Uint8Array {
  const out = new Uint8Array(len)
  if (!bytes.length) return out
  for (let i = 0; i < len; i++) out[i] = bytes[i % bytes.length]
  return out
}

function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (const v of b) s += (v < 16 ? '0' : '') + v.toString(16)
  return s
}

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function b64From24(b2: number, b1: number, b0: number, n: number, out: string[]): void {
  let w = (b2 << 16) | (b1 << 8) | b0
  for (let i = 0; i < n; i++) {
    out.push(ITOA64.charAt(w & 0x3f))
    w >>>= 6
  }
}

export function sha256crypt(password: string, salt: string): string {
  const pw = enc.encode(password)
  let sl = enc.encode(salt)
  if (sl.length > 16) sl = sl.subarray(0, 16)

  const B = sha256(concat(pw, sl, pw))

  const buf: Uint8Array[] = [pw, sl]
  let cnt: number
  for (cnt = pw.length; cnt > 32; cnt -= 32) buf.push(B)
  if (cnt > 0) buf.push(B.subarray(0, cnt))
  for (cnt = pw.length; cnt > 0; cnt >>= 1) buf.push(cnt & 1 ? B : pw)
  let C = sha256(concat(...buf))

  const pbuf: Uint8Array[] = []
  for (let i = 0; i < pw.length; i++) pbuf.push(pw)
  const P = repeatTo(sha256(concat(...pbuf)), pw.length)

  const sbuf: Uint8Array[] = []
  for (let i = 0; i < 16 + C[0]; i++) sbuf.push(sl)
  const S = repeatTo(sha256(concat(...sbuf)), sl.length)

  for (let r = 0; r < 5000; r++) {
    const parts: Uint8Array[] = []
    parts.push(r & 1 ? P : C)
    if (r % 3) parts.push(S)
    if (r % 7) parts.push(P)
    parts.push(r & 1 ? C : P)
    C = sha256(concat(...parts))
  }

  const out: string[] = []
  b64From24(C[0], C[10], C[20], 4, out)
  b64From24(C[21], C[1], C[11], 4, out)
  b64From24(C[12], C[22], C[2], 4, out)
  b64From24(C[3], C[13], C[23], 4, out)
  b64From24(C[24], C[4], C[14], 4, out)
  b64From24(C[15], C[25], C[5], 4, out)
  b64From24(C[6], C[16], C[26], 4, out)
  b64From24(C[27], C[7], C[17], 4, out)
  b64From24(C[18], C[28], C[8], 4, out)
  b64From24(C[9], C[19], C[29], 4, out)
  b64From24(0, C[31], C[30], 3, out)

  return '$5$' + salt + '$' + out.join('')
}

export const sha256hex = (s: string): string => bytesToHex(sha256(enc.encode(s)))

export function loginHash(username: string, password: string, salt: string, nonce: string): string {
  const passwd = sha256crypt(password, salt)
  return bytesToHex(sha256(enc.encode(`${username}:${passwd}:${nonce}`)))
}
