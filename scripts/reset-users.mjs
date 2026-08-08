import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.RESET_MEMBER_DATA !== "NUKE") {
  throw new Error("Refusing to reset accounts. Re-run with RESET_MEMBER_DATA=NUKE to confirm.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const members = await client.query(
    "SELECT user_id FROM identity.users WHERE account_type = 'member'",
  );
  const memberIds = members.rows.map((row) => row.user_id);

  if (memberIds.length) {
    // Rewards use RESTRICT FKs so a development reset must remove the wallet
    // rows before deleting identity users. Codes are returned to inventory
    // only when no redemption still owns them.
    await client.query("DELETE FROM rewards.point_ledger WHERE user_id = ANY($1::text[])", [memberIds]);
    await client.query("DELETE FROM rewards.redemptions WHERE user_id = ANY($1::text[])", [memberIds]);
    await client.query(
      `UPDATE rewards.offer_codes code
          SET status = 'available', updated_at = now()
        WHERE code.status = 'issued'
          AND NOT EXISTS (SELECT 1 FROM rewards.redemptions redemption WHERE redemption.code_id = code.code_id)`,
    );
    await client.query("DELETE FROM rewards.accounts WHERE user_id = ANY($1::text[])", [memberIds]);
  }

  const conversations = await client.query(
    `SELECT DISTINCT conversation.conversation_id
     FROM chat.conversations conversation
     LEFT JOIN chat.conversation_members member
       ON member.conversation_id = conversation.conversation_id
     WHERE conversation.created_by = ANY($1::text[])
        OR member.user_id = ANY($1::text[])`,
    [memberIds],
  );
  const conversationIds = conversations.rows.map((row) => row.conversation_id);
  if (conversationIds.length) {
    await client.query(
      "DELETE FROM chat.conversations WHERE conversation_id = ANY($1::text[])",
      [conversationIds],
    );
  }

  const authUsers = await client.query('SELECT count(*) FROM auth."user"');
  await client.query('DELETE FROM auth."verification"');
  await client.query('DELETE FROM auth."user"');
  if (memberIds.length) {
    await client.query(
      "DELETE FROM identity.users WHERE user_id = ANY($1::text[])",
      [memberIds],
    );
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({
    removedIdentityUsers: memberIds.length,
    removedConversations: conversationIds.length,
    removedAuthUsers: Number(authUsers.rows[0]?.count ?? 0),
    preservedCommunityUsers: true,
  }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
