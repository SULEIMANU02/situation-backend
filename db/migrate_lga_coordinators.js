import db from '../config/db.js';

async function migrateLgaCoordinators() {
  console.log('Starting Local Government Coordinators migration...');

  try {
    // 1. Create lga_coordinators table
    await db.query(`
      CREATE TABLE IF NOT EXISTS lga_coordinators (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sn INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        lga_name VARCHAR(50) NOT NULL,
        lga_id INT DEFAULT NULL,
        phone VARCHAR(30) NOT NULL,
        status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table lga_coordinators created or verified.');

    // 2. Clear previous entries
    await db.query(`TRUNCATE TABLE lga_coordinators;`);

    // 3. The 20 Coordinators
    const coordinators = [
      { sn: 1, name: 'MOHAMMED SHEHU FANTI', lga: 'Alkaleri', phone: '08065039713' },
      { sn: 2, name: 'ADAMU YAKUBU', lga: 'Bauchi', phone: '08031145272' },
      { sn: 3, name: 'VICTOR MADANG AUDU', lga: 'Bogoro', phone: '08083682272' },
      { sn: 4, name: 'MOHAMMED SHEHU', lga: 'Damban', phone: '08064830982' },
      { sn: 5, name: 'ABUBAKAR GARBA', lga: 'Darazo', phone: '07049244252' },
      { sn: 6, name: 'ADAMU DANJUMA', lga: 'Dass', phone: '08035845035' },
      { sn: 7, name: 'SHUAIBU UMAR GAMAWA', lga: 'Gamawa', phone: '08162168325' },
      { sn: 8, name: 'AUWAL MUHAMMAD KABIR', lga: 'Ganjuwa', phone: '08031369246' },
      { sn: 9, name: 'UMAR HUSSAINI GIADE', lga: 'Giade', phone: '08034419860' },
      { sn: 10, name: 'USMAN IDRIS', lga: 'Itas/Gadau', phone: '07067601618' },
      { sn: 11, name: 'YUSUF YAKUBU', lga: 'Jama\'are', phone: '07087798328' },
      { sn: 12, name: 'ALI GAMBO', lga: 'Katagum', phone: '08069627217' },
      { sn: 13, name: 'HON. MUHAMMAD BASHIR', lga: 'Kirfi', phone: '07063426430' },
      { sn: 14, name: 'SALLAU MUHAMMAD FANTA', lga: 'Misau', phone: '08036447267' },
      { sn: 15, name: 'HAMISU GAMBO', lga: 'Ningi', phone: '07062994618' },
      { sn: 16, name: 'MOHAMMED BAPPAH', lga: 'Shira', phone: '08161680392' },
      { sn: 17, name: 'NUHU ADAMU', lga: 'Tafawa Balewa', phone: '08065475192' },
      { sn: 18, name: 'MAL. SALE ZARANDA', lga: 'Toro', phone: '07069453918' },
      { sn: 19, name: 'ABUBAKAR ILYASU', lga: 'Warji', phone: '08063370557' },
      { sn: 20, name: 'BADAMASI HABUBA KATAGUM', lga: 'Zaki', phone: '07068754421' }
    ];

    // Fetch existing LGAs to link lga_id
    const lgaRows = await db.query('SELECT id, name FROM lgas;');

    for (const c of coordinators) {
      const match = lgaRows.find(l => l.name.toLowerCase() === c.lga.toLowerCase() || l.name.toLowerCase().includes(c.lga.toLowerCase().split('/')[0]));
      const lgaId = match ? match.id : null;

      await db.query(`
        INSERT INTO lga_coordinators (sn, name, lga_name, lga_id, phone)
        VALUES (?, ?, ?, ?, ?);
      `, [c.sn, c.name, c.lga, lgaId, c.phone]);
    }

    console.log(`Successfully migrated all ${coordinators.length} Local Government Coordinators to MySQL database!`);

    const rows = await db.query('SELECT sn, name, lga_name, phone FROM lga_coordinators ORDER BY sn ASC;');
    console.table(rows);

  } catch (error) {
    console.error('LGA Coordinators migration error:', error);
  } finally {
    process.exit(0);
  }
}

migrateLgaCoordinators();
