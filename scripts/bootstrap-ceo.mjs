import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const { Client } = pg;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createInviteToken() {
  return `pcp_bootstrap_${randomBytes(24).toString("hex")}`;
}

function resolveBaseUrl() {
  const fromEnv =
    process.env.BETTER_AUTH_BASE_URL ??
    process.env.PAPERCLIP_PUBLIC_URL ??
    process.env.BETTER_AUTH_URL;
  return (fromEnv ?? "http://localhost:3100").trim().replace(/\/+$/, "");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    console.log("[bootstrap] skipped: DATABASE_URL is not set.");
    return;
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const adminResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM instance_user_roles WHERE role = $1",
      ["instance_admin"],
    );
    const adminCount = adminResult.rows[0]?.count ?? 0;
    if (adminCount > 0) {
      console.log("[bootstrap] skipped: instance admin already exists.");
      return;
    }

    await client.query(
      `UPDATE invites
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE invite_type = $1
         AND revoked_at IS NULL
         AND accepted_at IS NULL
         AND expires_at > NOW()`,
      ["bootstrap_ceo"],
    );

    const token = createInviteToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO invites (
         invite_type,
         token_hash,
         allowed_join_types,
         expires_at,
         invited_by_user_id
       ) VALUES ($1, $2, $3, $4, $5)`,
      ["bootstrap_ceo", tokenHash, "human", expiresAt.toISOString(), "system"],
    );

    const baseUrl = resolveBaseUrl();
    const inviteUrl = `${baseUrl}/invite/${token}`;
    console.log("[bootstrap] created bootstrap CEO invite.");
    console.log(`[bootstrap] invite URL: ${inviteUrl}`);
    console.log(`[bootstrap] expires: ${expiresAt.toISOString()}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.log(`[bootstrap] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
