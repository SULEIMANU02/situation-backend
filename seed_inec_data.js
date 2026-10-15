import db from './config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_CODE = '05'; // Bauchi State
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/sadiqsalau/inec-ng-data/main/inecdata/states/5';

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      console.warn(`[Fetch Warn] Failed to fetch ${url} (attempt ${i + 1}/${retries}): ${err.message}`);
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, delay * (i + 1)));
    }
  }
}

async function runSeed() {
  console.log('==================================================');
  console.log('📥 Starting Bauchi State Wards & Polling Units Seed');
  console.log('==================================================\n');

  try {
    // 1. Fetch the LGAs list from GitHub
    console.log('Step 1: Fetching LGAs list...');
    const lgasRaw = await fetchWithRetry(`${GITHUB_RAW_BASE}/lgas.json`);
    const lgaList = Object.values(lgasRaw);
    console.log(`   Found ${lgaList.length} LGAs in Bauchi dataset.`);

    // 2. Fetch existing LGAs in the local DB to map names to database IDs
    console.log('\nStep 2: Connecting to local database & checking LGAs...');
    const localLgas = await db.query('SELECT id, name, code FROM lgas');
    if (!localLgas || localLgas.length === 0) {
      throw new Error('No LGAs found in local database. Please seed LGAs first using seed.sql or similar.');
    }
    console.log(`   Local DB contains ${localLgas.length} LGAs.`);

    const lgaMap = new Map();
    localLgas.forEach(l => {
      lgaMap.set(l.name.toUpperCase().trim(), l.id);
    });
    // Add mapping for Dambam/Damban name spelling variation
    if (lgaMap.has('DAMBAN')) {
      lgaMap.set('DAMBAM', lgaMap.get('DAMBAN'));
    }

    // 3. Clear existing wards and polling units (handling foreign key constraints)
    console.log('\nStep 3: Resetting existing wards & polling units data...');
    
    // First, check if there are election results or incidents registered
    const resultCheck = await db.query('SELECT COUNT(*) as count FROM election_results');
    const incidentCheck = await db.query('SELECT COUNT(*) as count FROM incidents');
    
    if (resultCheck[0].count > 0 || incidentCheck[0].count > 0) {
      console.log('⚠️  Existing election results or incident reports found.');
      console.log('   Temporarily clearing dependent rows to ensure database consistency...');
      await db.query('SET FOREIGN_KEY_CHECKS = 0');
      await db.query('TRUNCATE TABLE election_results');
      await db.query('TRUNCATE TABLE incidents');
      await db.query('SET FOREIGN_KEY_CHECKS = 1');
      console.log('   ✅ Cleaned election_results and incidents.');
    }

    // Set users polling_unit_id and ward_id to NULL to prevent constraint errors
    await db.query('UPDATE users SET polling_unit_id = NULL, ward_id = NULL');
    console.log('   ✅ Reset user PU/Ward assignments.');

    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    await db.query('TRUNCATE TABLE polling_units');
    await db.query('TRUNCATE TABLE wards');
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('   ✅ Wards and Polling Units tables truncated.');

    // Containers for mock JSON seed data
    const mockWards = [];
    const mockPollingUnits = [];
    let wardCounter = 1;
    let puCounter = 1;

    // 4. Scrape Wards & PUs hierarchically
    console.log('\nStep 4: Fetching and inserting Wards & Polling Units...');

    for (const lga of lgaList) {
      const lgaName = lga.name.toUpperCase().trim();
      const dbLgaId = lgaMap.get(lgaName);
      if (!dbLgaId) {
        console.error(`❌ LGA "${lgaName}" from INEC dataset does not match any local LGA name!`);
        continue;
      }

      console.log(`\n📂 Processing LGA: ${lgaName} (Local DB ID: ${dbLgaId}, Abbr: ${lga.abbreviation})`);

      // Fetch wards of this LGA
      const wardsUrl = `${GITHUB_RAW_BASE}/lgas/${lga.abbreviation}/wards.json`;
      const wardsRaw = await fetchWithRetry(wardsUrl);
      const wardsList = Object.values(wardsRaw);
      console.log(`   Found ${wardsList.length} Wards.`);

      for (const ward of wardsList) {
        const wardName = ward.name.toUpperCase().trim();
        
        // Insert Ward into local DB
        const wardInsert = await db.query(
          'INSERT INTO wards (lga_id, name) VALUES (?, ?)',
          [dbLgaId, wardName]
        );
        const dbWardId = wardInsert.insertId;

        // Push to mock JSON container
        mockWards.push({
          id: dbWardId || wardCounter++,
          lga_id: dbLgaId,
          name: wardName
        });

        // Fetch polling units of this ward
        const pusUrl = `${GITHUB_RAW_BASE}/lgas/${lga.abbreviation}/wards/${ward.abbreviation}/units.json`;
        let pusRaw;
        try {
          pusRaw = await fetchWithRetry(pusUrl);
        } catch (e) {
          console.error(`   ❌ Failed to load units for Ward ${wardName}. Skipping.`);
          continue;
        }
        
        const pusList = Object.values(pusRaw);
        
        // Insert PUs for this ward in bulk or sequentially
        for (const pu of pusList) {
          const puName = pu.name.toUpperCase().trim();
          // Generate INEC PU Code: SS/LL/WW/PPP
          const puCode = `${STATE_CODE}/${lga.abbreviation}/${ward.abbreviation}/${pu.abbreviation}`;

          const puInsert = await db.query(
            'INSERT INTO polling_units (ward_id, name, code, total_voters) VALUES (?, ?, ?, ?)',
            [dbWardId, puName, puCode, 0]
          );
          const dbPuId = puInsert.insertId;

          // Push to mock JSON container
          mockPollingUnits.push({
            id: dbPuId || puCounter++,
            ward_id: dbWardId || (wardCounter - 1),
            name: puName,
            code: puCode,
            total_voters: 0
          });
        }
      }
      
      console.log(`   ✅ Finished LGA ${lgaName}.`);
      // Add a slight delay to be nice to GitHub's raw server
      await new Promise(res => setTimeout(res, 500));
    }

    // 5. Write the mock JSON file
    console.log('\nStep 5: Writing mock JSON seed data file...');
    const seedDataPath = path.join(__dirname, 'db', 'bauchi_seed_data.json');
    
    // Ensure parent directories exist
    fs.mkdirSync(path.dirname(seedDataPath), { recursive: true });

    fs.writeFileSync(
      seedDataPath,
      JSON.stringify({ wards: mockWards, pollingUnits: mockPollingUnits }, null, 2),
      'utf8'
    );
    console.log(`   ✅ Seed JSON data successfully written to ${seedDataPath}`);

    // Log grand totals
    console.log('\n==================================================');
    console.log('🎉 SEED COMPLETED SUCCESSFULLY!');
    console.log(`Total Wards: ${mockWards.length}`);
    console.log(`Total Polling Units: ${mockPollingUnits.length}`);
    console.log('==================================================');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Fatal Seed Error:', err.message);
    process.exit(1);
  }
}

runSeed();
