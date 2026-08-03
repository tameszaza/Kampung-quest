import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.RESET_DATABASE !== "NUKE") {
  throw new Error("Refusing to reset the database. Re-run with RESET_DATABASE=NUKE to confirm.");
}

const communityMembers = [
  ["community_anne", "Anne Lim", "anne.lim", "community_anne@community.seniorquest.local", "/assets/profile-anne.jpg"],
  ["community_david", "David Lee", "david.lee", "community_david@community.seniorquest.local", "/assets/profile-david.jpg"],
  ["community_john", "John Tan", "john.tan", "community_john@community.seniorquest.local", "/assets/profile-john.jpg"],
];

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const tables = await client.query(
    `SELECT quote_ident(table_schema) || '.' || quote_ident(table_name) AS qualified_name
     FROM information_schema.tables
     WHERE table_type = 'BASE TABLE'
       AND table_schema IN ('auth', 'assistant', 'chat', 'identity', 'memory', 'quest', 'retrieval')
       AND NOT (table_schema = 'public' AND table_name = 'schema_migrations')
     ORDER BY table_schema, table_name`,
  );
  if (tables.rows.length) {
    await client.query(`TRUNCATE TABLE ${tables.rows.map((row) => row.qualified_name).join(", ")} RESTART IDENTITY CASCADE`);
  }

  for (const [id, fullName, username, email, photoUrl] of communityMembers) {
    await client.query(
      `INSERT INTO identity.users
         (user_id, full_name, username, email, phone, password_hash, preferred_language,
          area, photo_url, account_type, onboarding_complete)
       VALUES ($1, $2, $3, $4, NULL, NULL, 'English', 'Nearby', $5, 'community', true)`,
      [id, fullName, username, email, photoUrl],
    );
    await client.query(
      "INSERT INTO identity.user_preferences (user_id) VALUES ($1)",
      [id],
    );
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({
    reset: true,
    truncatedTables: tables.rows.length,
    seededCommunityMembers: communityMembers.length,
    seededActiveQuestAcceptances: 0,
  }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
