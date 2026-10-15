import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMock = process.env.MOCK_DB === 'true';

let pool = null;

// Real bcrypt hash for Admin@2026
const MOCK_HASH_ADMIN = '$2a$10$VNj.hvYM/t6xqk1BwYvVV.LB4hipqaHSPdrmb7rczpxohW/pAYo9a';

// Try to load custom geographic seed data if available
let localSeedWards = null;
let localSeedPus = null;

try {
  const seedPath = path.join(__dirname, '../db/bauchi_seed_data.json');
  if (fs.existsSync(seedPath)) {
    const rawData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    localSeedWards = rawData.wards;
    localSeedPus = rawData.pollingUnits;
  }
} catch (e) {
  console.log('Skipping loading local JSON seed data:', e.message);
}

// In-Memory Database for Mock Mode
export const mockDb = {
  lgas: [
    { id: 1, name: 'Alkaleri', code: 'ALW', latitude: 10.2667, longitude: 10.3333 },
    { id: 2, name: 'Bauchi', code: 'BAU', latitude: 10.3158, longitude: 9.8442 },
    { id: 3, name: 'Bogoro', code: 'BGR', latitude: 9.6833, longitude: 9.6000 },
    { id: 4, name: 'Damban', code: 'DBN', latitude: 11.4583, longitude: 10.7500 },
    { id: 5, name: 'Darazo', code: 'DRZ', latitude: 10.9944, longitude: 10.4136 },
    { id: 6, name: 'Dass', code: 'DSS', latitude: 10.0333, longitude: 9.5167 },
    { id: 7, name: 'Gamawa', code: 'GMW', latitude: 12.1333, longitude: 10.5333 },
    { id: 8, name: 'Ganjuwa', code: 'GNJ', latitude: 10.6333, longitude: 9.8333 },
    { id: 9, name: 'Giade', code: 'GDE', latitude: 11.4167, longitude: 10.2000 },
    { id: 10, name: 'Itas/Gadau', code: 'ITG', latitude: 11.9667, longitude: 10.0333 },
    { id: 11, name: 'Jama\'are', code: 'JMR', latitude: 11.6333, longitude: 9.9333 },
    { id: 12, name: 'Katagum', code: 'KTG', latitude: 11.7000, longitude: 10.2833 },
    { id: 13, name: 'Kirfi', code: 'KRF', latitude: 10.4000, longitude: 10.6833 },
    { id: 14, name: 'Misau', code: 'MSU', latitude: 11.3144, longitude: 10.4656 },
    { id: 15, name: 'Ningi', code: 'NNG', latitude: 11.0833, longitude: 9.5667 },
    { id: 16, name: 'Shira', code: 'SHR', latitude: 11.5333, longitude: 10.0500 },
    { id: 17, name: 'Tafawa Balewa', code: 'TFB', latitude: 9.7500, longitude: 9.5500 },
    { id: 18, name: 'Toro', code: 'TOR', latitude: 10.0500, longitude: 9.0667 },
    { id: 19, name: 'Warji', code: 'WRJ', latitude: 11.2167, longitude: 9.8167 },
    { id: 20, name: 'Zaki', code: 'ZAK', latitude: 12.2333, longitude: 10.3167 }
  ],
  wards: localSeedWards || [
    { id: 1, lga_id: 2, name: 'Majidadi A' },
    { id: 2, lga_id: 2, name: 'Majidadi B' },
    { id: 3, lga_id: 2, name: 'Makama A' },
    { id: 4, lga_id: 2, name: 'Makama B' },
    { id: 5, lga_id: 2, name: 'Dankade' },
    { id: 6, lga_id: 2, name: 'Hardo' },
    { id: 7, lga_id: 12, name: 'Azare Madangala' },
    { id: 8, lga_id: 12, name: 'Azare Bulutu' },
    { id: 9, lga_id: 12, name: 'Chinade' },
    { id: 10, lga_id: 18, name: 'Toro Ward' },
    { id: 11, lga_id: 18, name: 'Tilden Fulani' },
    { id: 12, lga_id: 18, name: 'Lame' },
    { id: 13, lga_id: 14, name: 'Misau Town' },
    { id: 14, lga_id: 14, name: 'Gwaram' },
    { id: 15, lga_id: 14, name: 'Hardawa' }
  ],
  pollingUnits: localSeedPus || [
    { id: 1, ward_id: 1, name: 'Kofar Fada PU 001', code: '02/02/01/001', total_voters: 520 },
    { id: 2, ward_id: 1, name: 'Central Primary School PU 002', code: '02/02/01/002', total_voters: 450 },
    { id: 3, ward_id: 2, name: 'Kofar Dumi PU 001', code: '02/02/02/001', total_voters: 600 },
    { id: 4, ward_id: 3, name: 'Jahun Primary School PU 001', code: '02/02/03/001', total_voters: 750 },
    { id: 5, ward_id: 3, name: 'Wunti Market PU 002', code: '02/02/03/002', total_voters: 480 },
    { id: 6, ward_id: 7, name: 'Azare Post Office PU 001', code: '12/12/01/001', total_voters: 650 },
    { id: 7, ward_id: 7, name: 'Low Cost Primary School PU 002', code: '12/12/01/002', total_voters: 500 },
    { id: 8, ward_id: 11, name: 'Tilde Town Hall PU 001', code: '18/18/02/001', total_voters: 400 },
    { id: 9, ward_id: 11, name: 'Market Square PU 002', code: '18/18/02/002', total_voters: 380 }
  ],
  users: [
    { id: 1, email: 'admin@apmsupport.com', password: MOCK_HASH_ADMIN, fullname: 'System Administrator', phone: '08031234567', role: 'SUPER_ADMIN', lga_id: null, ward_id: null, polling_unit_id: null, created_by: null, status: 'ACTIVE', created_at: new Date() },
    { id: 2, email: 'agent@apmsupport.com', password: MOCK_HASH_ADMIN, fullname: 'Bauchi Agent One', phone: '08099999999', role: 'POLLING_AGENT', lga_id: 2, ward_id: 1, polling_unit_id: 1, created_by: 1, status: 'ACTIVE', created_at: new Date() }
  ],
  incidents: [],
  results: [],
  campaignReports: [],
  directives: [
    {
      id: 1,
      ref_code: 'DIR-2027-001',
      title: 'Gov. Bala Youth Empowerment Skill Grant (Batch A)',
      category: 'EMPOWERMENT',
      priority: 'HIGH',
      description: 'Mobilize and register 5 verified youths per Polling Unit for technical vocation certification, toolkit grants & starter packs in solar technology and agro-mechanization.',
      target_per_pu: 5,
      deadline: '2026-09-30',
      created_by: 1,
      status: 'ACTIVE',
      created_at: new Date('2026-09-10T10:00:00Z')
    },
    {
      id: 2,
      ref_code: 'DIR-2027-002',
      title: 'Women Solar Micro-Credit Cooperative Scheme',
      category: 'MICRO_CREDIT',
      priority: 'MEDIUM',
      description: 'Register 3 women nano-business owners or market stall holders per PU for N50,000 zero-interest revolving seed grant.',
      target_per_pu: 3,
      deadline: '2026-09-25',
      created_by: 1,
      status: 'ACTIVE',
      created_at: new Date('2026-09-11T12:00:00Z')
    },
    {
      id: 3,
      ref_code: 'DIR-2027-003',
      title: 'Frontline PVC Verification & Mobilization Drive',
      category: 'MOBILIZATION',
      priority: 'URGENT',
      description: 'Audit uncollected PVCs at INEC ward centers and assist eligible voters with transportation and collection support.',
      target_per_pu: 20,
      deadline: '2026-09-30',
      created_by: 1,
      status: 'ACTIVE',
      created_at: new Date('2026-09-11T14:00:00Z')
    }
  ],
  directiveRelays: [
    { id: 1, directive_id: 1, from_tier: 'SUPER_ADMIN', to_tier: 'STEERING', relayed_by: 1, target_name: 'BILAL SHEHU', target_phone: '08069389755', target_lga: 'Bauchi', target_ward: null, delivery_method: 'WHATSAPP', delivery_status: 'DELIVERED', relayed_at: new Date('2026-09-10T10:15:00Z') },
    { id: 2, directive_id: 1, from_tier: 'STEERING', to_tier: 'LGA', relayed_by: 1, target_name: 'Alh. Danladi Garba', target_phone: '08031112222', target_lga: 'Bauchi', target_ward: null, delivery_method: 'WHATSAPP', delivery_status: 'DELIVERED', relayed_at: new Date('2026-09-10T10:30:00Z') },
    { id: 3, directive_id: 1, from_tier: 'LGA', to_tier: 'WARD', relayed_by: 1, target_name: 'Dan\'iya Ward Supervisor', target_phone: '08039998877', target_lga: 'Bauchi', target_ward: 'Dan\'iya', delivery_method: 'WHATSAPP', delivery_status: 'SENT', relayed_at: new Date('2026-09-10T11:00:00Z') }
  ],
  directiveResponses: [
    { id: 1, directive_id: 1, user_id: 2, from_tier: 'PU', response_type: 'ACKNOWLEDGED', message: 'Directive received at Kofar Fada PU. Mobilization commenced.', progress_count: 0, lga_name: 'Bauchi', ward_name: 'Dan\'iya', pu_name: 'Kofar Fada PU 001', phone: '08099999999', responded_at: new Date('2026-09-10T11:20:00Z') },
    { id: 2, directive_id: 1, user_id: 2, from_tier: 'PU', response_type: 'PROGRESS_UPDATE', message: 'Registered 3 youth solar trainees at Kofar Fada PU.', progress_count: 3, lga_name: 'Bauchi', ward_name: 'Dan\'iya', pu_name: 'Kofar Fada PU 001', phone: '08099999999', responded_at: new Date('2026-09-10T14:45:00Z') }
  ]
};

let activeHost = process.env.DB_HOST || '127.0.0.1';

function createPoolForHost(host) {
  return mysql.createPool({
    host: host,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'masupport',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
}

if (!isMock) {
  try {
    pool = createPoolForHost(activeHost);
    console.log(`MySQL Connection Pool initialized for host: ${activeHost}`);
  } catch (err) {
    console.error('MySQL Connection failed. Falling back to Mock Database mode.', err);
    process.env.MOCK_DB = 'true';
  }
} else {
  console.log('Running in MOCK DATABASE mode.');
}

const db = {
  query: async (sql, params = []) => {
    if (process.env.MOCK_DB === 'true' || isMock || !pool) {
      return executeMockQuery(sql, params);
    }
    try {
      const [results] = await pool.query(sql, params);
      return results;
    } catch (err) {
      // Auto-fallback: if access denied or connection error, try alternate host (127.0.0.1 <-> localhost)
      const altHost = activeHost === '127.0.0.1' ? 'localhost' : '127.0.0.1';
      if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        try {
          const fallbackPool = createPoolForHost(altHost);
          const [results] = await fallbackPool.query(sql, params);
          console.log(`🔄 [DB Auto-Switch] Successfully connected via alternate host: ${altHost}`);
          pool = fallbackPool;
          activeHost = altHost;
          return results;
        } catch (fallbackErr) {
          throw err;
        }
      }
      throw err;
    }
  }
};

// Mock query engine
function executeMockQuery(sql, params) {
  const cleanSql = sql.trim().replace(/\s+/g, ' ').toUpperCase();

  // 1. User email check / login check
  if (cleanSql.includes('FROM USERS WHERE EMAIL = ?')) {
    const user = mockDb.users.find(u => u.email.toLowerCase() === params[0].toLowerCase());
    return user ? [user] : [];
  }

  // 1b. User profile by ID
  if (cleanSql.includes('FROM USERS WHERE ID = ?')) {
    const user = mockDb.users.find(u => u.id === Number(params[0]));
    if (user) {
      const { password, ...safeUser } = user;
      return [safeUser];
    }
    return [];
  }

  // 1c. User profile by phone (for USSD)
  if (cleanSql.includes('FROM USERS WHERE PHONE IN')) {
    const matchingUsers = mockDb.users.filter(u => params.includes(u.phone) && u.status === 'ACTIVE');
    return matchingUsers;
  }

  // 2. Register / onboard user
  if (cleanSql.includes('INSERT INTO USERS')) {
    const newUser = {
      id: mockDb.users.length + 1,
      email: params[0],
      password: params[1],
      fullname: params[2],
      phone: params[3],
      role: params[4],
      lga_id: params[5] || null,
      ward_id: params[6] || null,
      polling_unit_id: params[7] || null,
      created_by: params[8] || null,
      status: 'ACTIVE',
      created_at: new Date()
    };
    mockDb.users.push(newUser);
    return { insertId: newUser.id };
  }

  // 3. Fetch users / agents (with joins)
  if (cleanSql.includes('FROM USERS U') || cleanSql.includes('FROM USERS U\n')) {
    let filteredUsers = [...mockDb.users];

    // Apply WHERE conditions based on params
    if (cleanSql.includes('U.LGA_ID = ?')) {
      filteredUsers = filteredUsers.filter(u => u.lga_id === Number(params[0]));
    } else if (cleanSql.includes('U.WARD_ID = ?')) {
      filteredUsers = filteredUsers.filter(u => u.ward_id === Number(params[0]));
    } else if (cleanSql.includes('U.ID = ?')) {
      filteredUsers = filteredUsers.filter(u => u.id === Number(params[0]));
    } else if (cleanSql.includes('U.CREATED_BY = ?')) {
      filteredUsers = filteredUsers.filter(u => u.created_by === Number(params[0]));
    }

    const enrichedUsers = filteredUsers.map(u => {
      const lga = mockDb.lgas.find(l => l.id === u.lga_id);
      const ward = mockDb.wards.find(w => w.id === u.ward_id);
      const pu = mockDb.pollingUnits.find(p => p.id === u.polling_unit_id);
      const creator = mockDb.users.find(c => c.id === u.created_by);
      return {
        ...u,
        lga_name: lga ? lga.name : null,
        ward_name: ward ? ward.name : null,
        polling_unit_name: pu ? pu.name : null,
        created_by_name: creator ? creator.fullname : null
      };
    });
    return enrichedUsers;
  }

  if (cleanSql.startsWith('SELECT * FROM USERS')) {
    return mockDb.users;
  }

  // 3b. Check user by ID for status update
  if (cleanSql.includes('SELECT ID, ROLE, LGA_ID, WARD_ID, CREATED_BY FROM USERS WHERE ID = ?')) {
    const user = mockDb.users.find(u => u.id === Number(params[0]));
    return user ? [{ id: user.id, role: user.role, lga_id: user.lga_id, ward_id: user.ward_id, created_by: user.created_by }] : [];
  }

  // 3c. Update user status
  if (cleanSql.includes('UPDATE USERS SET STATUS')) {
    const status = params[0];
    const id = Number(params[1]);
    const userIndex = mockDb.users.findIndex(u => u.id === id);
    if (userIndex > -1) {
      mockDb.users[userIndex].status = status;
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }

  // 4. Fetch LGAs
  if (cleanSql.includes('FROM LGAS WHERE ID = ?')) {
    const lga = mockDb.lgas.find(l => l.id === Number(params[0]));
    return lga ? [lga] : [];
  }

  if (cleanSql.startsWith('SELECT * FROM LGAS')) {
    return mockDb.lgas;
  }

  // 5. Fetch Wards
  if (cleanSql.includes('FROM WARDS WHERE ID = ?')) {
    const ward = mockDb.wards.find(w => w.id === Number(params[0]));
    return ward ? [ward] : [];
  }

  if (cleanSql.startsWith('SELECT * FROM WARDS')) {
    if (cleanSql.includes('WHERE LGA_ID = ?')) {
      return mockDb.wards.filter(w => w.lga_id === Number(params[0]));
    }
    return mockDb.wards;
  }

  // 6. Fetch Polling Units
  if (cleanSql.includes('FROM POLLING_UNITS WHERE ID = ?')) {
    const pu = mockDb.pollingUnits.find(p => p.id === Number(params[0]));
    return pu ? [pu] : [];
  }

  if (cleanSql.includes('FROM POLLING_UNITS WHERE CODE = ?')) {
    const pu = mockDb.pollingUnits.find(p => p.code === params[0]);
    return pu ? [pu] : [];
  }

  if (cleanSql.includes('FROM POLLING_UNITS WHERE CODE IN')) {
    const matchingPus = mockDb.pollingUnits.filter(pu => params.includes(pu.code));
    return matchingPus;
  }

  if (cleanSql.includes('FROM POLLING_UNITS PU JOIN WARDS W') && cleanSql.includes('WHERE PU.ID = ?')) {
    const pu = mockDb.pollingUnits.find(p => p.id === Number(params[0]));
    if (pu) {
      const ward = mockDb.wards.find(w => w.id === pu.ward_id);
      return [{
        ward_id: pu.ward_id,
        lga_id: ward ? ward.lga_id : null
      }];
    }
    return [];
  }

  if (cleanSql.startsWith('SELECT * FROM POLLING_UNITS')) {
    if (cleanSql.includes('WHERE WARD_ID = ?')) {
      return mockDb.pollingUnits.filter(pu => pu.ward_id === Number(params[0]));
    }
    return mockDb.pollingUnits;
  }

  if (cleanSql.startsWith('INSERT INTO POLLING_UNITS')) {
    const newPu = {
      id: mockDb.pollingUnits.length + 1,
      ward_id: Number(params[0]),
      name: params[1],
      code: params[2],
      total_voters: Number(params[3] || 0)
    };
    mockDb.pollingUnits.push(newPu);
    return { insertId: newPu.id };
  }

  if (cleanSql.startsWith('DELETE FROM POLLING_UNITS WHERE ID = ?')) {
    const puId = Number(params[0]);
    mockDb.pollingUnits = mockDb.pollingUnits.filter(p => p.id !== puId);
    // Cascade delete results
    mockDb.results = mockDb.results.filter(r => r.polling_unit_id !== puId);
    return { affectedRows: 1 };
  }

  // 7. Election Results
  // 7a. Count queries
  if (cleanSql.includes('COUNT(ID) AS COUNT')) {
    if (cleanSql.includes('ELECTION_RESULTS')) {
      return [{ count: mockDb.results.length }];
    }
    if (cleanSql.includes('POLLING_UNITS')) {
      return [{ count: mockDb.pollingUnits.length }];
    }
  }

  // 7b. Sum / Totals query
  if (cleanSql.includes('SUM(APM_VOTES)') || cleanSql.includes('APM_TOTAL') || cleanSql.includes('SUM(ADC_VOTES)') || cleanSql.includes('ADC_TOTAL') || cleanSql.includes('SUM(APC_VOTES)') || cleanSql.includes('APC_TOTAL')) {
    const apm_total = mockDb.results.reduce((sum, r) => sum + (r.apm_votes || 0), 0);
    const apc_total = mockDb.results.reduce((sum, r) => sum + (r.apc_votes || 0), 0);
    const pdp_total = mockDb.results.reduce((sum, r) => sum + (r.pdp_votes || 0), 0);
    const prp_total = mockDb.results.reduce((sum, r) => sum + (r.prp_votes || 0), 0);
    const adc_total = mockDb.results.reduce((sum, r) => sum + (r.adc_votes || 0), 0);
    const invalid_total = mockDb.results.reduce((sum, r) => sum + (r.invalid_votes || 0), 0);
    const grand_total = mockDb.results.reduce((sum, r) => sum + (r.total_votes || 0), 0);
    return [{
      apm_total,
      apc_total,
      pdp_total,
      prp_total,
      adc_total,
      invalid_total,
      grand_total
    }];
  }

  // 7c. Check existing PU result
  if (cleanSql.startsWith('SELECT ID FROM ELECTION_RESULTS WHERE POLLING_UNIT_ID = ?')) {
    return mockDb.results.filter(r => r.polling_unit_id === Number(params[0]));
  }

  // 7d. Insert PU results
  if (cleanSql.includes('INSERT INTO ELECTION_RESULTS')) {
    const puId = Number(params[0]);
    const apm = Number(params[1]);
    const apc = Number(params[2]);
    const pdp = Number(params[3]);
    const prp = Number(params[4]);
    const adc = Number(params[5]);
    const invalid = Number(params[6]);
    
    let total, sheetUrl, userId;
    if (params.length >= 10) {
      total = Number(params[7]);
      sheetUrl = params[8] || null;
      userId = Number(params[9]);
    } else {
      total = apm + apc + pdp + prp + adc + invalid;
      sheetUrl = null;
      userId = Number(params[8]);
    }

    const newResult = {
      id: mockDb.results.length + 1,
      polling_unit_id: puId,
      apm_votes: apm,
      apc_votes: apc,
      pdp_votes: pdp,
      prp_votes: prp,
      adc_votes: adc,
      invalid_votes: invalid,
      total_votes: total,
      result_sheet_url: sheetUrl,
      submitted_by: userId,
      created_at: new Date()
    };
    mockDb.results.push(newResult);
    return { insertId: newResult.id };
  }

  // 7e. Update PU results
  if (cleanSql.includes('UPDATE ELECTION_RESULTS')) {
    const puId = Number(params[params.length - 1]);
    const existingIndex = mockDb.results.findIndex(r => r.polling_unit_id === puId);
    if (existingIndex > -1) {
      const apm = Number(params[0]);
      const apc = Number(params[1]);
      const pdp = Number(params[2]);
      const prp = Number(params[3]);
      const adc = Number(params[4]);
      const invalid = Number(params[5]);
      const total = Number(params[6]);
      const userId = Number(params[7]);

      mockDb.results[existingIndex].apm_votes = apm;
      mockDb.results[existingIndex].apc_votes = apc;
      mockDb.results[existingIndex].pdp_votes = pdp;
      mockDb.results[existingIndex].prp_votes = prp;
      mockDb.results[existingIndex].adc_votes = adc;
      mockDb.results[existingIndex].invalid_votes = invalid;
      mockDb.results[existingIndex].total_votes = total;
      mockDb.results[existingIndex].submitted_by = userId;

      if (params.length === 10) {
        mockDb.results[existingIndex].result_sheet_url = params[8];
      }
      mockDb.results[existingIndex].created_at = new Date();
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }

  // 7f. LGA Aggregates
  if (cleanSql.includes('GROUP BY L.ID') || cleanSql.includes('GROUP BY L.NAME')) {
    const lgaSums = mockDb.lgas.map(lga => {
      const lgaWards = mockDb.wards.filter(w => w.lga_id === lga.id).map(w => w.id);
      const lgaPus = mockDb.pollingUnits.filter(pu => lgaWards.includes(pu.ward_id)).map(pu => pu.id);
      const lgaResults = mockDb.results.filter(r => lgaPus.includes(r.polling_unit_id));

      const apm = lgaResults.reduce((sum, r) => sum + (r.apm_votes || 0), 0);
      const apc = lgaResults.reduce((sum, r) => sum + (r.apc_votes || 0), 0);
      const pdp = lgaResults.reduce((sum, r) => sum + (r.pdp_votes || 0), 0);
      const prp = lgaResults.reduce((sum, r) => sum + (r.prp_votes || 0), 0);
      const adc = lgaResults.reduce((sum, r) => sum + (r.adc_votes || 0), 0);
      const invalid = lgaResults.reduce((sum, r) => sum + (r.invalid_votes || 0), 0);
      const total = lgaResults.reduce((sum, r) => sum + (r.total_votes || 0), 0);
      const reporting_pus = lgaResults.length;
      const total_pus = lgaPus.length || 5;

      return {
        lga_id: lga.id,
        lga_name: lga.name,
        apm_votes: apm,
        apc_votes: apc,
        pdp_votes: pdp,
        prp_votes: prp,
        adc_votes: adc,
        invalid_votes: invalid,
        total_votes: total,
        reporting_pus,
        total_pus
      };
    });
    return lgaSums;
  }

  // 7g. Direct result list enriched
  if (cleanSql.includes('FROM ELECTION_RESULTS')) {
    const enrichedResults = mockDb.results.map(r => {
      const pu = mockDb.pollingUnits.find(p => p.id === r.polling_unit_id);
      const ward = pu ? mockDb.wards.find(w => w.id === pu.ward_id) : null;
      const lga = ward ? mockDb.lgas.find(l => l.id === ward.lga_id) : null;
      const submitter = mockDb.users.find(u => u.id === r.submitted_by);
      return {
        ...r,
        polling_unit_name: pu ? pu.name : 'Unknown PU',
        polling_unit_code: pu ? pu.code : '',
        ward_name: ward ? ward.name : '',
        ward_id: ward ? ward.id : null,
        lga_name: lga ? lga.name : '',
        lga_id: lga ? lga.id : null,
        submitted_by_name: submitter ? submitter.fullname : 'System'
      };
    });
    enrichedResults.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return enrichedResults;
  }

  // 8. Fetch Incidents
  if (cleanSql.includes('FROM INCIDENTS')) {
    const enrichedIncidents = mockDb.incidents.map(inc => {
      const lga = mockDb.lgas.find(l => l.id === inc.lga_id);
      const ward = mockDb.wards.find(w => w.id === inc.ward_id);
      const pu = mockDb.pollingUnits.find(p => p.id === inc.polling_unit_id);
      const reporter = mockDb.users.find(u => u.id === inc.reported_by);
      return {
        ...inc,
        lga_name: lga ? lga.name : '',
        ward_name: ward ? ward.name : '',
        polling_unit_name: pu ? pu.name : '',
        reported_by_name: reporter ? reporter.fullname : 'Field Agent'
      };
    });
    enrichedIncidents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (cleanSql.includes("I.STATUS IN ('VERIFIED', 'RESOLVED')")) {
      return enrichedIncidents.filter(inc => inc.status === 'VERIFIED' || inc.status === 'RESOLVED');
    }
    return enrichedIncidents;
  }

  // 9. Log Incident
  if (cleanSql.includes('INSERT INTO INCIDENTS')) {
    const newInc = {
      id: mockDb.incidents.length + 1,
      title: params[0],
      description: params[1],
      category: params[2],
      lga_id: Number(params[3]),
      ward_id: params[4] ? Number(params[4]) : null,
      polling_unit_id: params[5] ? Number(params[5]) : null,
      reported_by: Number(params[6]),
      image_url: params[7] || null,
      status: 'PENDING',
      created_at: new Date()
    };
    mockDb.incidents.push(newInc);
    return { insertId: newInc.id };
  }

  // 10. Update Incident Status
  if (cleanSql.includes('UPDATE INCIDENTS SET STATUS')) {
    const status = params[0];
    const id = Number(params[1]);
    const incIndex = mockDb.incidents.findIndex(inc => inc.id === id);
    if (incIndex > -1) {
      mockDb.incidents[incIndex].status = status;
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }

  // 11. Campaign Reports
  if (cleanSql.includes('FROM CAMPAIGN_REPORTS')) {
    const enrichedCamp = mockDb.campaignReports.map(c => {
      const lga = mockDb.lgas.find(l => l.id === c.lga_id);
      const reporter = mockDb.users.find(u => u.id === c.reported_by);
      const ward = reporter ? mockDb.wards.find(w => w.id === reporter.ward_id) : null;
      const pu = reporter ? mockDb.pollingUnits.find(p => p.id === reporter.polling_unit_id) : null;
      return {
        ...c,
        lga_name: lga ? lga.name : '',
        reported_by_name: reporter ? reporter.fullname : 'Campaign Staff',
        reporter_role: reporter ? reporter.role : 'SUPER_ADMIN',
        ward_name: ward ? ward.name : null,
        polling_unit_name: pu ? pu.name : null,
        polling_unit_code: pu ? pu.code : null
      };
    });
    enrichedCamp.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return enrichedCamp;
  }

  if (cleanSql.includes('INSERT INTO CAMPAIGN_REPORTS')) {
    const newCamp = {
      id: mockDb.campaignReports.length + 1,
      title: params[0],
      description: params[1],
      activity_type: params[2],
      lga_id: Number(params[3]),
      attendee_count: Number(params[4]),
      sentiment: params[5],
      reported_by: Number(params[6]),
      created_at: new Date()
    };
    mockDb.campaignReports.push(newCamp);
    return { insertId: newCamp.id };
  }

  // 12. Directives System Mock Handlers
  if (cleanSql.includes('COUNT(ID) AS COUNT FROM DIRECTIVES') || cleanSql.includes('COUNT(*) AS COUNT FROM DIRECTIVES')) {
    return [{ count: mockDb.directives.length }];
  }

  if (cleanSql.includes('INSERT INTO DIRECTIVES')) {
    const newDir = {
      id: mockDb.directives.length + 1,
      ref_code: params[0],
      title: params[1],
      category: params[2] || 'GENERAL',
      priority: params[3] || 'MEDIUM',
      description: params[4],
      target_per_pu: Number(params[5] || 0),
      deadline: params[6] || null,
      created_by: Number(params[7] || 1),
      status: 'ACTIVE',
      created_at: new Date()
    };
    mockDb.directives.unshift(newDir);
    return { insertId: newDir.id };
  }

  if (cleanSql.includes('FROM DIRECTIVES WHERE STATUS =') || cleanSql.includes("WHERE STATUS = 'ACTIVE'")) {
    const active = mockDb.directives.filter(d => d.status === 'ACTIVE');
    active.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (cleanSql.includes('LIMIT 1')) {
      return active.slice(0, 1);
    }
    return active;
  }

  if (cleanSql.includes('FROM DIRECTIVES WHERE ID = ?')) {
    const dir = mockDb.directives.find(d => d.id === Number(params[0]));
    return dir ? [dir] : [];
  }

  if (cleanSql.includes('FROM DIRECTIVES')) {
    const copy = [...mockDb.directives];
    copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return copy;
  }

  if (cleanSql.includes('UPDATE DIRECTIVES')) {
    const id = Number(params[params.length - 1]);
    const dir = mockDb.directives.find(d => d.id === id);
    if (dir) {
      if (cleanSql.includes('SET STATUS = ?')) dir.status = params[0];
      if (cleanSql.includes('SET TITLE = ?')) dir.title = params[0];
      if (cleanSql.includes('SET DESCRIPTION = ?')) dir.description = params[0];
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }

  // 13. Directive Relays Mock Handlers
  if (cleanSql.includes('FROM DIRECTIVE_RELAYS WHERE DIRECTIVE_ID = ? GROUP BY TO_TIER, DELIVERY_STATUS')) {
    const dirId = Number(params[0]);
    const dirRelays = mockDb.directiveRelays.filter(r => r.directive_id === dirId);
    const groups = {};
    for (const r of dirRelays) {
      const key = `${r.to_tier}_${r.delivery_status}`;
      if (!groups[key]) groups[key] = { to_tier: r.to_tier, delivery_status: r.delivery_status, count: 0 };
      groups[key].count++;
    }
    return Object.values(groups);
  }

  if (cleanSql.includes('INSERT INTO DIRECTIVE_RELAYS')) {
    const newRelay = {
      id: mockDb.directiveRelays.length + 1,
      directive_id: Number(params[0]),
      from_tier: params[1],
      to_tier: params[2],
      relayed_by: Number(params[3] || 1),
      target_phone: params[4] || null,
      target_name: params[5] || null,
      target_lga: params[6] || null,
      target_ward: params[7] || null,
      delivery_method: params[8] || 'PORTAL',
      delivery_status: params[9] || 'PENDING',
      relayed_at: new Date()
    };
    mockDb.directiveRelays.unshift(newRelay);
    return { insertId: newRelay.id };
  }

  if (cleanSql.includes('FROM DIRECTIVE_RELAYS')) {
    if (params.length > 0) {
      const dirId = Number(params[0]);
      return mockDb.directiveRelays.filter(r => r.directive_id === dirId);
    }
    return mockDb.directiveRelays;
  }

  // 14. Directive Responses Mock Handlers
  if (cleanSql.includes('FROM DIRECTIVE_RESPONSES WHERE DIRECTIVE_ID = ? GROUP BY RESPONSE_TYPE')) {
    const dirId = Number(params[0]);
    const dirResps = mockDb.directiveResponses.filter(r => r.directive_id === dirId);
    const groups = {};
    for (const r of dirResps) {
      if (!groups[r.response_type]) groups[r.response_type] = { response_type: r.response_type, count: 0 };
      groups[r.response_type].count++;
    }
    return Object.values(groups);
  }

  if (cleanSql.includes('FROM DIRECTIVE_RESPONSES WHERE DIRECTIVE_ID = ? AND LGA_NAME IS NOT NULL GROUP BY LGA_NAME')) {
    const dirId = Number(params[0]);
    const dirResps = mockDb.directiveResponses.filter(r => r.directive_id === dirId && r.lga_name);
    const groups = {};
    for (const r of dirResps) {
      if (!groups[r.lga_name]) {
        groups[r.lga_name] = {
          lga_name: r.lga_name,
          total_progress: 0,
          total_reports: 0,
          completed_count: 0,
          issue_count: 0
        };
      }
      groups[r.lga_name].total_progress += Number(r.progress_count || 0);
      groups[r.lga_name].total_reports++;
      if (r.response_type === 'COMPLETED') groups[r.lga_name].completed_count++;
      if (r.response_type === 'ISSUE') groups[r.lga_name].issue_count++;
    }
    return Object.values(groups);
  }

  if (cleanSql.includes('INSERT INTO DIRECTIVE_RESPONSES')) {
    const newResp = {
      id: mockDb.directiveResponses.length + 1,
      directive_id: Number(params[0]),
      user_id: params[1] ? Number(params[1]) : null,
      from_tier: params[2],
      response_type: params[3],
      message: params[4],
      progress_count: Number(params[5] || 0),
      lga_name: params[6] || null,
      ward_name: params[7] || null,
      pu_name: params[8] || null,
      phone: params[9] || null,
      responded_at: new Date()
    };
    mockDb.directiveResponses.unshift(newResp);
    return { insertId: newResp.id };
  }

  if (cleanSql.includes('FROM DIRECTIVE_RESPONSES')) {
    if (params.length > 0) {
      const dirId = Number(params[0]);
      return mockDb.directiveResponses.filter(r => r.directive_id === dirId);
    }
    return mockDb.directiveResponses;
  }

  // Generic fallback: empty array
  return [];
}

export default db;
