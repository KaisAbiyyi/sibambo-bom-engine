const K = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

/** Browser- and Node-safe synchronous SHA-256 for deterministic IDs. */
export function sha256Hex(input: string): string {
	const encoded = new TextEncoder().encode(input);
	const bytes = [...encoded, 0x80];
	while ((bytes.length % 64) !== 56) bytes.push(0);
	const bitLength = encoded.length * 8;
	for (let shift = 56; shift >= 0; shift -= 8) bytes.push(Math.floor(bitLength / 2 ** shift) & 0xff);
	let [a, b, c, d, e, f, g, h] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
	for (let offset = 0; offset < bytes.length; offset += 64) {
		const w = Array<number>(64).fill(0);
		for (let i = 0; i < 16; i++) w[i] = (bytes[offset + i * 4] << 24) | (bytes[offset + i * 4 + 1] << 16) | (bytes[offset + i * 4 + 2] << 8) | bytes[offset + i * 4 + 3];
		for (let i = 16; i < 64; i++) { const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3); const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
		let [aa, bb, cc, dd, ee, ff, gg, hh] = [a, b, c, d, e, f, g, h];
		for (let i = 0; i < 64; i++) { const s1 = ((ee >>> 6) | (ee << 26)) ^ ((ee >>> 11) | (ee << 21)) ^ ((ee >>> 25) | (ee << 7)); const choice = (ee & ff) ^ (~ee & gg); const t1 = (hh + s1 + choice + K[i] + w[i]) | 0; const s0 = ((aa >>> 2) | (aa << 30)) ^ ((aa >>> 13) | (aa << 19)) ^ ((aa >>> 22) | (aa << 10)); const majority = (aa & bb) ^ (aa & cc) ^ (bb & cc); [hh, gg, ff, ee, dd, cc, bb, aa] = [gg, ff, ee, (dd + t1) | 0, cc, bb, aa, (t1 + s0 + majority) | 0]; }
		[a, b, c, d, e, f, g, h] = [(a + aa) | 0, (b + bb) | 0, (c + cc) | 0, (d + dd) | 0, (e + ee) | 0, (f + ff) | 0, (g + gg) | 0, (h + hh) | 0];
	}
	return [a, b, c, d, e, f, g, h].map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

type Hasher = { update(value: string): Hasher; digest(encoding: string): string };

export function createSha256Hasher(): Hasher {
	const BunHasher = (globalThis as { Bun?: { CryptoHasher?: new (algorithm: string) => Hasher } }).Bun?.CryptoHasher;
	if (BunHasher) return new BunHasher('sha256');
	let buffer = '';
	return { update(value: string) { buffer += value; return this; }, digest(_encoding: string) { return sha256Hex(buffer); } };
}

export function sha256Digest(input: string): string {
	return createSha256Hasher().update(input).digest('hex');
}
