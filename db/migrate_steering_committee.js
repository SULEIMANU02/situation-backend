import db from '../config/db.js';

async function migrateSteeringCommittee() {
  console.log('Starting State Steering Committee migration...');

  try {
    // 1. Create state_steering_committee table
    await db.query(`
      CREATE TABLE IF NOT EXISTS state_steering_committee (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sn INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        supervising_lgas VARCHAR(255) NOT NULL,
        phone VARCHAR(30) NOT NULL,
        role_title VARCHAR(100) DEFAULT 'State Steering Committee Member',
        status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table state_steering_committee created or verified.');

    // 2. Clear previous entries if any or insert fresh
    await db.query(`TRUNCATE TABLE state_steering_committee;`);

    // 3. The 9 Coordinators from the official Yan Akwati list
    const coordinators = [
      {
        sn: 1,
        name: 'BILAL SHEHU',
        supervising_lgas: 'BAUCHI, DARAZO',
        phone: '08069389755',
        role_title: 'Central Bauchi & Darazo Coordinator'
      },
      {
        sn: 2,
        name: 'ABDUL AHMED BURRA',
        supervising_lgas: 'ALKALERI, KIRFI',
        phone: '08024577854',
        role_title: 'Alkaleri & Kirfi Coordinator'
      },
      {
        sn: 3,
        name: 'KABIRU ALHASSAN',
        supervising_lgas: 'DAMBAM, KATAGUM, JAMAARE',
        phone: '08034067484',
        role_title: 'Northern Zone Coordinator (Dambam, Katagum, Jama\'are)'
      },
      {
        sn: 4,
        name: 'SULEIMAN YERIMA',
        supervising_lgas: 'GIADE, MISAU, SHIRA',
        phone: '08060544410',
        role_title: 'Central-North Coordinator (Giade, Misau, Shira)'
      },
      {
        sn: 5,
        name: 'HAMZA MOHAMMED',
        supervising_lgas: 'TAFAWA BALEWA, DASS, BOGORO',
        phone: '08133286968',
        role_title: 'Southern Zone Coordinator (Tafawa Balewa, Dass, Bogoro)'
      },
      {
        sn: 6,
        name: 'RAJI ABDULFATAH',
        supervising_lgas: 'GAMAWA, ZAKI, ITAS GADAU',
        phone: '08036785410',
        role_title: 'Far-North Coordinator (Gamawa, Zaki, Itas/Gadau)'
      },
      {
        sn: 7,
        name: 'AUWAL ISHAQ',
        supervising_lgas: 'NINGI, WARJI, GANJUWA',
        phone: '08069429461',
        role_title: 'Western Zone Coordinator (Ningi, Warji, Ganjuwa)'
      },
      {
        sn: 8,
        name: 'JAMILU HUSSEINI ZAKARI',
        supervising_lgas: 'TORO',
        phone: '08039099161',
        role_title: 'Toro Strategic Sector Coordinator'
      },
      {
        sn: 9,
        name: 'ISA BABAYO',
        supervising_lgas: 'AKUYAM',
        phone: '07037389039',
        role_title: 'Akuyam Sector Coordinator & State Advisory'
      }
    ];

    for (const c of coordinators) {
      await db.query(`
        INSERT INTO state_steering_committee (sn, name, supervising_lgas, phone, role_title)
        VALUES (?, ?, ?, ?, ?);
      `, [c.sn, c.name, c.supervising_lgas, c.phone, c.role_title]);
    }

    console.log(`Successfully migrated ${coordinators.length} State Steering Committee members to MySQL database!`);

    // Fetch and display
    const rows = await db.query('SELECT * FROM state_steering_committee ORDER BY sn ASC;');
    console.log('Current database records:');
    console.table(rows.map(r => ({
      SN: r.sn,
      Name: r.name,
      'Supervising LGAs': r.supervising_lgas,
      Phone: r.phone,
      Role: r.role_title
    })));

  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    process.exit(0);
  }
}

migrateSteeringCommittee();
