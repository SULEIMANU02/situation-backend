import db from './config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeCode(code) {
  if (!code) return '';
  return code.toString().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

async function migrate() {
  console.log('====================================================');
  console.log('🔄 STARTING DATABASE MIGRATION WITH NEW VOTER DATA');
  console.log('====================================================\n');

  try {
    // 1. Read seed JSON file
    const seedPath = path.join(__dirname, 'db', 'bauchi_seed_data.json');
    if (!fs.existsSync(seedPath)) {
      throw new Error(`Seed JSON file not found at: ${seedPath}`);
    }
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const { wards: newWards, pollingUnits: newPUs } = seedData;

    console.log(`Loaded ${newWards.length} Wards and ${newPUs.length} Polling Units from JSON.`);

    // 2. Backup existing references to re-link after re-population
    console.log('\nStep 1: Inspecting existing users, results, and incidents to preserve references...');

    // Users with ward or PU
    const existingUsers = await db.query(`
      SELECT u.id, u.email, u.role, u.lga_id, u.ward_id, u.polling_unit_id,
             pu.code as pu_code, pu.name as pu_name,
             w.name as ward_name
      FROM users u
      LEFT JOIN polling_units pu ON u.polling_unit_id = pu.id
      LEFT JOIN wards w ON u.ward_id = w.id
      WHERE u.ward_id IS NOT NULL OR u.polling_unit_id IS NOT NULL
    `);
    console.log(`  Found ${existingUsers.length} user(s) with PU/Ward assigned.`);
    existingUsers.forEach(u => {
      console.log(`    User ${u.id} (${u.email}, ${u.role}): PU=${u.pu_name} (${u.pu_code}), Ward=${u.ward_name}`);
    });

    // Election results
    const existingResults = await db.query(`
      SELECT er.id, er.polling_unit_id, pu.code as pu_code
      FROM election_results er
      LEFT JOIN polling_units pu ON er.polling_unit_id = pu.id
    `);
    console.log(`  Found ${existingResults.length} election result(s) logged.`);

    // Incidents
    const existingIncidents = await db.query(`
      SELECT inc.id, inc.ward_id, inc.polling_unit_id,
             pu.code as pu_code, w.name as ward_name, inc.lga_id
      FROM incidents inc
      LEFT JOIN polling_units pu ON inc.polling_unit_id = pu.id
      LEFT JOIN wards w ON inc.ward_id = w.id
    `);
    console.log(`  Found ${existingIncidents.length} incident report(s) logged.`);

    // 3. Temporarily disable foreign keys and truncate wards & polling units
    console.log('\nStep 2: Clearing old wards and polling_units tables...');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    await db.query('TRUNCATE TABLE polling_units');
    await db.query('TRUNCATE TABLE wards');
    console.log('  ✅ Cleaned wards & polling_units tables.');

    // 4. Insert new Wards
    console.log('\nStep 3: Inserting 212 Wards into database...');
    // Map to remember inserted ward ID: key is `${lga_id}::${ward_name.toUpperCase()}`
    const wardIdMap = new Map();

    for (const ward of newWards) {
      const res = await db.query(
        'INSERT INTO wards (lga_id, name) VALUES (?, ?)',
        [ward.lga_id, ward.name]
      );
      const insertedWardId = res.insertId;
      wardIdMap.set(`${ward.lga_id}::${ward.name.toUpperCase()}`, insertedWardId);
      // Also map old mock ID from seed if useful
      wardIdMap.set(`OLD_ID::${ward.id}`, insertedWardId);
    }
    console.log(`  ✅ Successfully inserted ${newWards.length} Wards.`);

    // 5. Insert new Polling Units (in batches of 500 for optimal performance)
    console.log('\nStep 4: Inserting 5,423 Polling Units with registered voters...');
    const puIdByCode = new Map();
    const batchSize = 500;

    for (let i = 0; i < newPUs.length; i += batchSize) {
      const batch = newPUs.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];

      for (const pu of batch) {
        // Resolve newly inserted ward ID
        const targetWardId = wardIdMap.get(`OLD_ID::${pu.ward_id}`);
        if (!targetWardId) {
          throw new Error(`Could not find inserted Ward for PU: ${pu.name} (Ward ref ${pu.ward_id})`);
        }

        placeholders.push('(?, ?, ?, ?)');
        values.push(targetWardId, pu.name, pu.code, pu.total_voters || 0);
      }

      const sql = `INSERT INTO polling_units (ward_id, name, code, total_voters) VALUES ${placeholders.join(', ')}`;
      const res = await db.query(sql, values);
      
      // Node mysql2 auto-increment starting ID
      let startId = res.insertId;
      for (let j = 0; j < batch.length; j++) {
        const currentPu = batch[j];
        const assignedId = startId + j;
        const normCode = normalizeCode(currentPu.code);
        puIdByCode.set(normCode, assignedId);
        // Also map raw code
        puIdByCode.set(currentPu.code, assignedId);
      }
    }
    console.log(`  ✅ Successfully inserted ${newPUs.length} Polling Units with voter counts.`);

    // 6. Remap Users
    console.log('\nStep 5: Re-linking existing user accounts...');
    for (const u of existingUsers) {
      let newWardId = null;
      let newPuId = null;

      if (u.pu_code) {
        const norm = normalizeCode(u.pu_code);
        newPuId = puIdByCode.get(norm);
      }
      if (u.ward_name && u.lga_id) {
        newWardId = wardIdMap.get(`${u.lga_id}::${u.ward_name.toUpperCase()}`);
      }

      // If user had a PU, find the ward from the PU if not found directly
      if (newPuId && !newWardId) {
        const [puRow] = await db.query('SELECT ward_id FROM polling_units WHERE id = ?', [newPuId]);
        if (puRow) newWardId = puRow.ward_id;
      }

      await db.query(
        'UPDATE users SET ward_id = ?, polling_unit_id = ? WHERE id = ?',
        [newWardId, newPuId, u.id]
      );
      console.log(`  User ${u.id} (${u.email}) remapped: Ward ID=${newWardId}, PU ID=${newPuId}`);
    }

    // 7. Remap Election Results
    console.log('\nStep 6: Re-linking existing election results...');
    for (const er of existingResults) {
      if (er.pu_code) {
        const norm = normalizeCode(er.pu_code);
        const newPuId = puIdByCode.get(norm);
        if (newPuId) {
          await db.query('UPDATE election_results SET polling_unit_id = ? WHERE id = ?', [newPuId, er.id]);
          console.log(`  Result ${er.id} remapped to PU ID=${newPuId}`);
        } else {
          console.warn(`  ⚠️ Could not find new PU for result ${er.id} (code: ${er.pu_code})`);
        }
      }
    }

    // 8. Remap Incidents
    console.log('\nStep 7: Re-linking existing incident reports...');
    for (const inc of existingIncidents) {
      let newWardId = null;
      let newPuId = null;

      if (inc.pu_code) {
        const norm = normalizeCode(inc.pu_code);
        newPuId = puIdByCode.get(norm);
      }
      if (inc.ward_name && inc.lga_id) {
        newWardId = wardIdMap.get(`${inc.lga_id}::${inc.ward_name.toUpperCase()}`);
      }

      if (newPuId && !newWardId) {
        const [puRow] = await db.query('SELECT ward_id FROM polling_units WHERE id = ?', [newPuId]);
        if (puRow) newWardId = puRow.ward_id;
      }

      await db.query(
        'UPDATE incidents SET ward_id = ?, polling_unit_id = ? WHERE id = ?',
        [newWardId, newPuId, inc.id]
      );
      console.log(`  Incident ${inc.id} remapped to Ward ID=${newWardId}, PU ID=${newPuId}`);
    }

    // 9. Re-enable foreign key checks
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\nStep 8: Re-enabled foreign key constraints.');

    // 10. Verification
    const [wardCountRes] = await db.query('SELECT COUNT(*) as count FROM wards');
    const [puCountRes] = await db.query('SELECT COUNT(*) as count, SUM(total_voters) as total_voters FROM polling_units');
    const [relinkedUserRes] = await db.query('SELECT id, email, ward_id, polling_unit_id FROM users WHERE polling_unit_id IS NOT NULL');
    const [relinkedResultRes] = await db.query('SELECT id, polling_unit_id FROM election_results');

    console.log('\n====================================================');
    console.log('🎉 MIGRATION VERIFICATION SUMMARY');
    console.log('====================================================');
    console.log(`Total Wards in DB:          ${wardCountRes.count}`);
    console.log(`Total Polling Units in DB:  ${puCountRes.count}`);
    console.log(`Total Registered Voters:    ${Number(puCountRes.total_voters).toLocaleString()}`);
    console.log(`Relinked Agent Users:       ${JSON.stringify(relinkedUserRes)}`);
    console.log(`Relinked Results:           ${JSON.stringify(relinkedResultRes)}`);
    console.log('====================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Fatal Migration Error:', err);
    try {
      await db.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (_) {}
    process.exit(1);
  }
}

migrate();
