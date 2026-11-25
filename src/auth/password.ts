import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Stored form: scrypt$<log2 N>$<r>$<p>$<salt b64>$<hash b64>. The parameters
// travel with the hash, so raising the cost later does not lock anyone out.
const R = 8;
const P = 1;
const KEY_LEN = 32;

function derive(password: string, salt: Buffer, log2n: number): Promise<Buffer> {
  const N = 2 ** log2n;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, { N, r: R, p: P, maxmem: 256 * N * R }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string, log2n: number): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, log2n);
  return ["scrypt", log2n, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, log2n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !log2n || r !== String(R) || p !== String(P) || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(log2n));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
