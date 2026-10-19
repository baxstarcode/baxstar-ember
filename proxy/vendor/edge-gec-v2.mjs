// SPDX-License-Identifier: LGPL-3.0-only
// Adapted from edge-tts 7.3.1, src/edge_tts/drm.py (rany <rany@riseup.net>).
// JavaScript port for Cloudflare Workers, 2026-10-19. See edge-gec-LICENSE.txt.
// Protocol compatibility only: the public Edge client token is not a user secret.
// Keep this server-side. Do not replace this modified digest with WebCrypto SHA-256.

const SHA256_INITIAL = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
const SHA256_STATE = [4255104674, 2435071207, 3192492180, 3442351626, 1811967817, 79508907, 4272990180, 66059218];
const SHA256_SCHEDULE = [3945054110, 358115615, 2696978146, 217723578, 2787307148, 3520959633, 3235718560, 4192668342, 4039316851, 1884868174, 1904797190, 15051571, 3529027680, 1920361828];
const SHA256_ROUND_CONSTANTS = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298];
const CS64_COEFFICIENTS = [[3895366065, 3005677776], [1155409094, 2296378653], [1005282748, 693190712], [3365689651, 3005795295], [2367603217, 3557143765], [827258325, 652566332], [3911487921, 1618477510], [4037392853, 2192753147], [101076211, 4199654362], [3665427040, 545047652], [3201434976, 1010595059], [2314848760, 3536931681], [905590982, 3137643201], [3410617286, 3311559015]];
const CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const u32 = (v) => v >>> 0;
const mul = (a, b) => Math.imul(a, b) >>> 0;
const rol16 = (v) => ((v << 16) | (v >>> 16)) >>> 0;
const ror = (v, n) => (v >>> n) | (v << (32 - n));
const sigma0 = (v) => (ror(v, 7) ^ ror(v, 18) ^ (v >>> 3)) >>> 0;
const sigma1 = (v) => (ror(v, 17) ^ ror(v, 19) ^ (v >>> 10)) >>> 0;

function expand(words, start = 16) {
  for (let i = start; i < 64; i++) {
    words[i] = u32(sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]);
  }
}
function rounds(state, words, first = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = first; i < 64; i++) {
    const constant = first === 14 && i === 14 ? 0xC9DC06A7 : SHA256_ROUND_CONSTANTS[i];
    const t1 = u32(h + u32(ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + u32(g ^ (e & (f ^ g))) + constant + words[i]);
    const t2 = u32(u32(ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + u32((a & b) | (c & (a | b))));
    [a, b, c, d, e, f, g, h] = [u32(t1 + t2), a, b, c, u32(d + t1), e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}
function initial(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const words = Array(14).fill(0);
  words.push((data[0] << 16) | (data[1] << 8) | data[2], view.getUint32(3));
  for (let i = 16; i < 30; i++) {
    let value = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) value += u32(sigma1(words[i - 2]) ^ (i === 16 ? 0x000B92C0 : 0));
    if (i - 7 >= 14) value += words[i - 7];
    if (i - 15 >= 14) value += u32(sigma0(words[i - 15]) ^ (i === 29 ? 0x059C0B80 : 0));
    words.push(u32(value));
  }
  words.push(u32(sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + 0xC9DC06A7 - SHA256_ROUND_CONSTANTS[14]));
  expand(words, 31);
  return rounds(SHA256_STATE, words, 14).map((v, i) => u32(v + SHA256_INITIAL[i]));
}
function digest(data) {
  const length = 57 + data.length;
  const zeroes = ((55 - length) % 64 + 64) % 64;
  const padded = new Uint8Array(data.length - 7 + 1 + zeroes + 8);
  padded.set(data.subarray(7));
  padded[data.length - 7] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, BigInt(length) * 8n);
  let state = initial(data);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4));
    expand(words);
    state = rounds(state, words).map((v, i) => u32(v + state[i]));
  }
  const out = new Uint8Array(32);
  state.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
}
function cs64(data, sha) {
  const view = new DataView(sha.buffer);
  const ka = u32(view.getUint32(0, true) | 1), kb = u32(view.getUint32(4, true) | 1);
  const factors = [mul(ka, 0x82893933), mul(kb, 0x82893933)];
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) => mul(coefficient, factors[i % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  const padded = new Uint8Array(Math.ceil((data.length + 1) / 8) * 8);
  padded.set(data, 1);
  const words = new DataView(padded.buffer);
  for (let i = 0; i < padded.length / 4; i++) {
    const word = words.getUint32(i * 4, true);
    let term = mul(word, i % 2 === 0 ? ka : kb);
    let offset = mul(rol16(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB);
    if (i === 0) { term = u32(term + mul(0xF2F90B1A, factors[0])); offset = u32(offset + 0x0B1A0000); }
    terms.push(term); offsets.push(offset);
  }
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const [x, y] = [terms[i], terms[i + 1]];
    let q = mul(rol16(u32(offsets[i] + x)), 0x76F50F34);
    swapAcc = u32(swapAcc + u32(mul(rol16(q), 0xC3EFEA97) + q));
    q = mul(rol16(u32(offsets[i + 1] + y)), 0x1881CE3C);
    swapLast = u32(mul(rol16(q), 0x35BD1EC9) + q);
    swapAcc = u32(swapAcc + swapLast);
    state = u32(mul(state, ka) + x);
    for (const factor of [0xCF98B111, 0x87085B9F, 0x12CEB96D, 0x257E1D83]) state = mul(rol16(state), factor);
    acc = u32(acc + state);
    let t = u32(mul(state, kb) + y);
    for (const factor of [0xA27416F5, 0xD38396FF, 0x7C932B89, 0xBFA49F69]) t = mul(rol16(t), factor);
    state = t; acc = u32(acc + state);
  }
  const out = new Uint8Array(8), result = new DataView(out.buffer);
  result.setUint32(0, u32(swapLast ^ state), true);
  result.setUint32(4, u32(swapAcc ^ acc), true);
  return out;
}
const hex = (bytes) => [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
let cachedTicks, cachedToken;
export function edgeGecV2(now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("Invalid speech clock");
  const seconds = BigInt(Math.floor(now / 1000)) + 11644473600n;
  const ticks = (seconds - seconds % 300n) * 10000000n;
  if (ticks === cachedTicks) return cachedToken;
  const data = new TextEncoder().encode(`${ticks}${CLIENT_TOKEN}`);
  const sha = digest(data);
  cachedToken = `${hex(cs64(data, sha))}-${hex(sha)}`;
  cachedTicks = ticks;
  return cachedToken;
}
