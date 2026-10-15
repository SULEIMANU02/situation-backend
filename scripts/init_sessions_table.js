import db from '../config/db.js';

export async function ensureWhatsAppSessionsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      session_id VARCHAR(64) NOT NULL DEFAULT 'default',
      file_name VARCHAR(128) NOT NULL,
      file_data LONGTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, file_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  try {
    await db.query(sql);
    console.log('✅ whatsapp_sessions table verified / created in database.');
    return true;
  } catch (err) {
    console.error('❌ Failed to ensure whatsapp_sessions table:', err.message);
    return false;
  }
}

if (process.argv[1]?.endsWith('init_sessions_table.js')) {
  ensureWhatsAppSessionsTable().then(() => process.exit(0)).catch(() => process.exit(1));
}
