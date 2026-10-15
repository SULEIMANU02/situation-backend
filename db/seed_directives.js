import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function seed() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'masupport'
  });

  console.log('🌱 Seeding directives...');

  const [existing] = await connection.execute('SELECT COUNT(*) as c FROM directives');
  if (existing[0].c === 0) {

  // 1. Directives
  await connection.execute(`
    INSERT INTO directives (id, ref_code, title, category, priority, description, target_per_pu, deadline, created_by, status)
    VALUES 
    (1, 'DIR-2027-001', 'Gov. Bala Youth Empowerment Skill Grant (Batch A)', 'EMPOWERMENT', 'HIGH', 
     'Mobilize and register 5 verified youths per Polling Unit for technical vocation certification, toolkit grants & starter packs in solar technology and agro-mechanization.', 5, '2026-09-30', NULL, 'ACTIVE'),
    (2, 'DIR-2027-002', 'Women Solar Micro-Credit Cooperative Scheme', 'MICRO_CREDIT', 'MEDIUM', 
     'Register 3 women nano-business owners or market stall holders per PU for N50,000 zero-interest revolving seed grant.', 3, '2026-09-25', NULL, 'ACTIVE'),
    (3, 'DIR-2027-003', 'Frontline PVC Verification & Mobilization Drive', 'MOBILIZATION', 'URGENT', 
     'Audit uncollected PVCs at INEC ward centers and assist eligible voters with transportation and collection support.', 20, '2026-09-30', NULL, 'ACTIVE')
  `);
  }

  // 2. Directive Relays
  const [existingRelays] = await connection.execute('SELECT COUNT(*) as c FROM directive_relays');
  if (existingRelays[0].c === 0) {
    await connection.execute(`
    INSERT INTO directive_relays (directive_id, from_tier, to_tier, relayed_by, target_name, target_phone, target_lga, delivery_method, delivery_status)
    VALUES
    (1, 'SUPER_ADMIN', 'STEERING', NULL, 'BILAL SHEHU', '08069389755', 'Bauchi', 'WHATSAPP', 'DELIVERED'),
    (1, 'STEERING', 'LGA', NULL, 'Alh. Danladi Garba', '08031112222', 'Bauchi', 'WHATSAPP', 'DELIVERED'),
    (1, 'LGA', 'WARD', NULL, 'Dan\\'iya Ward Supervisor', '08039998877', 'Bauchi', 'WHATSAPP', 'SENT'),
    (2, 'SUPER_ADMIN', 'STEERING', NULL, 'BILAL SHEHU', '08069389755', 'Bauchi', 'WHATSAPP', 'DELIVERED'),
    (2, 'STEERING', 'LGA', NULL, 'Alh. Danladi Garba', '08031112222', 'Bauchi', 'WHATSAPP', 'DELIVERED'),
    (3, 'SUPER_ADMIN', 'STEERING', NULL, 'BILAL SHEHU', '08069389755', 'Bauchi', 'WHATSAPP', 'DELIVERED'),
    (3, 'STEERING', 'LGA', NULL, 'Alh. Danladi Garba', '08031112222', 'Bauchi', 'WHATSAPP', 'DELIVERED'),
    (3, 'LGA', 'WARD', NULL, 'Dan\\'iya Ward Supervisor', '08039998877', 'Bauchi', 'WHATSAPP', 'DELIVERED'),
    (3, 'WARD', 'PU', NULL, 'Bauchi Agent One', '08099999999', 'Bauchi', 'WHATSAPP', 'DELIVERED')
  `);
  }

  // 3. Directive Responses (Upward feedback)
  const [existingResponses] = await connection.execute('SELECT COUNT(*) as c FROM directive_responses');
  if (existingResponses[0].c === 0) {
    await connection.execute(`
    INSERT INTO directive_responses (directive_id, user_id, from_tier, response_type, message, progress_count, lga_name, ward_name, pu_name, phone)
    VALUES
    (1, NULL, 'PU', 'ACKNOWLEDGED', 'Directive received at Kofar Fada PU. Mobilization commenced.', 0, 'Bauchi', 'Dan\\'iya', 'Kofar Fada PU 001', '08099999999'),
    (1, NULL, 'PU', 'PROGRESS_UPDATE', 'Registered 3 youth solar trainees at Kofar Fada PU.', 3, 'Bauchi', 'Dan\\'iya', 'Kofar Fada PU 001', '08099999999'),
    (3, NULL, 'PU', 'PROGRESS_UPDATE', '14 PVCs verified and collected at Kofar Fada PU.', 14, 'Bauchi', 'Dan\\'iya', 'Kofar Fada PU 001', '08099999999'),
    (1, NULL, 'WARD', 'FIELD_REPORT', 'Ward mobilization meeting held. 12 polling units briefed.', 0, 'Bauchi', 'Dan\\'iya', NULL, '08039998877')
  `);
  }

  console.log('✅ Directives, relays, and upward responses seeded successfully!');
  await connection.end();
}

seed().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
