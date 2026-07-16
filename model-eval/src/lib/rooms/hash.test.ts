import { expect, test } from 'bun:test';
import { createSha256Hasher, sha256Digest, sha256Hex } from './hash';

test('sha256Hex is portable and matches SHA-256 vectors', () => {
	expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('browser-safe and Bun-native paths produce identical deterministic digests', () => {
	const input = 'room-loop-cache-key';
	const expected = '1f81ce1eaa0dbbca21deb535152781e0e17c0d29947750c81eadddc58ca8dc70';

	expect(sha256Hex(input)).toBe(expected);
	expect(sha256Digest(input)).toBe(expected);
	expect(sha256Digest(input)).toBe(sha256Digest(input));
	expect(sha256Digest(`${input}:changed`)).not.toBe(expected);
});

test('normal Bun tests select Bun CryptoHasher instead of the browser fallback', () => {
	const hasher = createSha256Hasher();
	expect(hasher).toBeInstanceOf(Bun.CryptoHasher);
	expect(hasher.update('abc').digest('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
