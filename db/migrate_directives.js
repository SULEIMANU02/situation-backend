/**
 * Migration: Create Directives Cascading System Tables
 * 
 * Tables:
 *   - directives: Strategic tasks/commands created by Super Admin
 *   - directive_relays: Tracks cascading delivery from tier to tier
 *   - directive_responses: Upward reports from field agents back to command
 * 
 * Run: node db/migrate_directives.js
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'masupport'
  });

  console.log('🔗 Connected to MySQL. Running directives migration...');

  // 1. Directives Table — Strategic tasks from Super Admin
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS directives (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ref_code VARCHAR(30) NOT NULL UNIQUE,
      title VARCHAR(200) NOT NULL,
      category ENUM('EMPOWERMENT', 'MOBILIZATION', 'LOGISTICS', 'SECURITY', 'VOTER_DRIVE', 'MICRO_CREDIT', 'GENERAL') NOT NULL DEFAULT 'GENERAL',
      priority ENUM('URGENT', 'HIGH', 'MEDIUM', 'LOW') NOT NULL DEFAULT 'MEDIUM',
      description TEXT NOT NULL,
      target_per_pu INT DEFAULT 0,
      deadline DATE DEFAULT NULL,
      created_by INT DEFAULT NULL,
      status ENUM('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED') DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('✅ Table `directives` created.');

  // 2. Directive Relays — Tracks cascading from tier to tier
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS directive_relays (
      id INT AUTO_INCREMENT PRIMARY KEY,
      directive_id INT NOT NULL,
      from_tier ENUM('SUPER_ADMIN', 'STEERING', 'LGA', 'WARD') NOT NULL,
      to_tier ENUM('STEERING', 'LGA', 'WARD', 'PU') NOT NULL,
      relayed_by INT DEFAULT NULL,
      target_phone VARCHAR(20) DEFAULT NULL,
      target_name VARCHAR(100) DEFAULT NULL,
      target_lga VARCHAR(50) DEFAULT NULL,
      target_ward VARCHAR(100) DEFAULT NULL,
      delivery_method ENUM('WHATSAPP', 'SMS', 'PORTAL', 'MANUAL') DEFAULT 'PORTAL',
      delivery_status ENUM('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED') DEFAULT 'PENDING',
      relayed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (directive_id) REFERENCES directives(id) ON DELETE CASCADE,
      FOREIGN KEY (relayed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('✅ Table `directive_relays` created.');

  // 3. Directive Responses — Upward reports from field agents
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS directive_responses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      directive_id INT NOT NULL,
      user_id INT DEFAULT NULL,
      from_tier ENUM('PU', 'WARD', 'LGA', 'STEERING') NOT NULL,
      response_type ENUM('ACKNOWLEDGED', 'PROGRESS_UPDATE', 'COMPLETED', 'ISSUE', 'FIELD_REPORT') NOT NULL,
      message TEXT NOT NULL,
      progress_count INT DEFAULT 0,
      lga_name VARCHAR(50) DEFAULT NULL,
      ward_name VARCHAR(100) DEFAULT NULL,
      pu_name VARCHAR(150) DEFAULT NULL,
      phone VARCHAR(20) DEFAULT NULL,
      responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (directive_id) REFERENCES directives(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('✅ Table `directive_responses` created.');

  console.log('\n🎉 Directives migration completed successfully!');
  await connection.end();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
