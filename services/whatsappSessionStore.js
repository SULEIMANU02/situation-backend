import fs from 'fs';
import path from 'path';
import db from '../config/db.js';

const TABLE_NAME = 'whatsapp_sessions';

/**
 * Ensures the whatsapp_sessions table exists in the database.
 */
export async function ensureSessionTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        session_id VARCHAR(64) NOT NULL DEFAULT 'default',
        file_name VARCHAR(128) NOT NULL,
        file_data LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id, file_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await db.query(sql);
    return true;
  } catch (err) {
    console.warn('⚠️ Could not verify whatsapp_sessions table:', err.message);
    return false;
  }
}

/**
 * Restores all saved Baileys auth files from MySQL to the local disk directory.
 * This guarantees a ONE-TIME CONNECTION across server restarts, crashes, and cloud redeployments.
 */
export async function restoreSessionFiles(targetDir = 'auth_info_baileys', sessionId = 'default') {
  try {
    await ensureSessionTable();

    const rows = await db.query(
      `SELECT file_name, file_data FROM ${TABLE_NAME} WHERE session_id = ?`,
      [sessionId]
    );

    if (!rows || rows.length === 0) {
      console.log('ℹ️ No saved WhatsApp session found in database. Initial QR scan will be required.');
      return false;
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let restoredCount = 0;
    for (const row of rows) {
      if (row.file_name && row.file_data) {
        const filePath = path.join(targetDir, row.file_name);
        fs.writeFileSync(filePath, row.file_data, 'utf8');
        restoredCount++;
      }
    }

    console.log(`💾 Successfully restored ${restoredCount} WhatsApp auth files from MySQL database.`);
    console.log(`🔑 One-Time Connection active: Silent background reconnection enabled without QR code.`);
    return true;
  } catch (err) {
    console.error('❌ Failed to restore session from database:', err.message);
    return false;
  }
}

/**
 * Persists all current Baileys session files from disk into the MySQL database.
 */
export async function syncSessionFiles(sourceDir = 'auth_info_baileys', sessionId = 'default') {
  try {
    if (!fs.existsSync(sourceDir)) return false;

    const files = fs.readdirSync(sourceDir);
    if (files.length === 0) return false;

    await ensureSessionTable();

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(sourceDir, file);
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        await db.query(
          `INSERT INTO ${TABLE_NAME} (session_id, file_name, file_data)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE file_data = VALUES(file_data), updated_at = NOW()`,
          [sessionId, file, fileContent]
        );
      } catch (fileErr) {
        // Ignore locked or transient files
      }
    }

    return true;
  } catch (err) {
    console.warn('⚠️ Could not sync session to database:', err.message);
    return false;
  }
}

/**
 * Checks if a valid session already exists in DB or disk.
 */
export async function hasSavedSession(dir = 'auth_info_baileys', sessionId = 'default') {
  // Check disk first
  const credsPath = path.join(dir, 'creds.json');
  if (fs.existsSync(credsPath)) {
    try {
      const stat = fs.statSync(credsPath);
      if (stat.size > 20) return true;
    } catch (e) {}
  }

  // Check DB
  try {
    const rows = await db.query(
      `SELECT COUNT(*) as cnt FROM ${TABLE_NAME} WHERE session_id = ? AND file_name = 'creds.json'`,
      [sessionId]
    );
    const count = rows[0]?.cnt || rows?.cnt || 0;
    return count > 0;
  } catch (err) {
    return false;
  }
}

/**
 * Completely clears the saved session from database and disk (only on manual reset).
 */
export async function clearSession(targetDir = 'auth_info_baileys', sessionId = 'default') {
  try {
    await db.query(`DELETE FROM ${TABLE_NAME} WHERE session_id = ?`, [sessionId]);
    console.log(`🗑️ Deleted WhatsApp session from database (session: ${sessionId}).`);
  } catch (err) {
    console.warn('⚠️ Could not clear session from database:', err.message);
  }

  try {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.log(`🗑️ Cleared local auth directory: ${targetDir}`);
    }
  } catch (err) {
    console.warn('⚠️ Could not clear local auth dir:', err.message);
  }
}
