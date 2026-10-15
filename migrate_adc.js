import db from './config/db.js';

async function migrate() {
  try {
    console.log('Checking database table structure for election_results...');
    
    // Add column
    await db.query('ALTER TABLE election_results ADD COLUMN adc_votes INT DEFAULT 0 AFTER prp_votes');
    
    console.log('✅ Column `adc_votes` successfully added to `election_results` table!');
    process.exit(0);
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️ Column `adc_votes` already exists.');
      process.exit(0);
    } else {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  }
}

migrate();
