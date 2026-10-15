import db from './config/db.js';

async function migrate() {
  try {
    console.log('Adding voice_recording_url column to election_results table...');
    
    await db.query('ALTER TABLE election_results ADD COLUMN voice_recording_url VARCHAR(512) DEFAULT NULL');
    
    console.log('✅ Column `voice_recording_url` successfully added to `election_results` table!');
    process.exit(0);
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️ Column `voice_recording_url` already exists.');
      process.exit(0);
    } else {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  }
}

migrate();
