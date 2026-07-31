/**
 * Base58 (Bitcoin alphabet) — how every identifier in this protocol is
 * written down.
 *
 * A node renders `PublicKey`, `PeerId`, `Signature` and `EventId` as
 * base58 strings in JSON, so this is what a client both reads and, more
 * importantly, must *write*: a signed payload's transcript is
 * `JSON.stringify(payload)`, and a payload carrying a public key as an
 * array of numbers hashes to something the node will not reproduce, so
 * the signature simply fails to verify.
 *
 * Hand-rolled rather than pulling in `bs58`, matching this SDK's existing
 * choice to hand-encode the Anchor wire format instead of adding `borsh`:
 * the algorithm is twenty lines and the dependency would be carried by
 * every consumer of the package.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Reverse lookup, built once. `-1` marks a character outside the alphabet. */
const VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(ALPHABET, (character, index) => [character, index] as const),
);

export class Base58Error extends Error {}

/** Encode bytes as base58. Leading zero bytes become leading `1`s. */
export function encodeBase58(bytes: Uint8Array): string {
  // Repeated division of the whole number by 58, done base-256 digit by
  // digit so this stays exact for any length without needing BigInt.
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += (digits[i] ?? 0) << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;

  return (
    "1".repeat(leadingZeros) +
    digits
      .reverse()
      .map((digit) => ALPHABET[digit] ?? "")
      .join("")
  );
}

/**
 * Decode a base58 string. Throws {@link Base58Error} on any character
 * outside the alphabet — `0`, `O`, `I` and `l` are deliberately absent
 * from it, so a transcription slip fails loudly here rather than
 * producing different bytes than the writer intended.
 */
export function decodeBase58(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const value = VALUES.get(character);
    if (value === undefined) {
      throw new Base58Error(`'${character}' is not a base58 character (in "${text}")`);
    }
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingOnes = 0;
  while (leadingOnes < text.length && text[leadingOnes] === "1") leadingOnes += 1;

  return new Uint8Array([...new Array<number>(leadingOnes).fill(0), ...bytes.reverse()]);
}
