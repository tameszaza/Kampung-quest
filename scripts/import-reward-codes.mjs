import { createCipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const encryptionSecret = process.env.REWARD_CODE_ENCRYPTION_KEY?.trim();
const fingerprintSecret = process.env.REWARD_CODE_FINGERPRINT_KEY?.trim() ?? encryptionSecret;
const [offerId] = process.argv.slice(2);

if (!databaseUrl || !encryptionSecret || !fingerprintSecret || !offerId) {
  console.error("Usage: cat codes.txt | DATABASE_URL=... REWARD_CODE_ENCRYPTION_KEY=<32-byte-hex> [REWARD_CODE_FINGERPRINT_KEY=...] node scripts/import-reward-codes.mjs <offer-id>");
  process.exit(1);
}

// Read bearer codes from stdin, never from argv (which is visible in shell
// history and process listings). One code per line; blank lines are ignored.
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const codes = stdin
  .split(/\r?\n/)
  .map((code) => code.trim())
  .filter(Boolean);
if (codes.length === 0) throw new Error("No reward codes were provided on stdin");

const key = /^[0-9a-f]{64}$/i.test(encryptionSecret)
  ? Buffer.from(encryptionSecret, "hex")
  : Buffer.from(encryptionSecret, "base64");
if (key.length !== 32) throw new Error("REWARD_CODE_ENCRYPTION_KEY must be a 32-byte hex or base64 value");

function encrypt(code) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const code of codes) {
    const fingerprint = createHmac("sha256", fingerprintSecret).update(code).digest("hex");
    await client.query(
      `INSERT INTO rewards.offer_codes
        (code_id, offer_id, code_fingerprint, encrypted_code, encryption_key_version, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, 'available', now(), now())
       ON CONFLICT (code_fingerprint) DO NOTHING`,
      [`code_${randomUUID()}`, offerId, fingerprint, encrypt(code)],
    );
  }
  await client.query("COMMIT");
  console.log(`Imported ${codes.length} code(s) for ${offerId}.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
