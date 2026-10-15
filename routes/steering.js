import express from 'express';
import db from '../config/db.js';

const router = express.Router();

// GET /api/steering-committee - List all 9 coordinators and their allocated LGAs
router.get('/', async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM state_steering_committee ORDER BY sn ASC;');
    res.json({
      success: true,
      total: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching state steering committee:', error);
    res.status(500).json({ success: false, message: 'Server error fetching steering committee' });
  }
});

// POST /api/steering-committee/update-lga - Update LGA allocation
router.post('/update-lga', async (req, res) => {
  const { id, supervising_lgas } = req.body;
  if (!id || !supervising_lgas) {
    return res.status(400).json({ success: false, message: 'id and supervising_lgas are required.' });
  }

  try {
    await db.query('UPDATE state_steering_committee SET supervising_lgas = ? WHERE id = ?;', [supervising_lgas, id]);
    res.json({ success: true, message: 'LGA allocations updated successfully.' });
  } catch (error) {
    console.error('Error updating LGA allocations:', error);
    res.status(500).json({ success: false, message: 'Server error updating LGA allocation' });
  }
});

// GET /api/steering-committee/lga-coordinators - List all 20 LGA coordinators
router.get('/lga-coordinators', async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM lga_coordinators ORDER BY sn ASC;');
    res.json({
      success: true,
      total: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching LGA coordinators:', error);
    res.status(500).json({ success: false, message: 'Server error fetching LGA coordinators' });
  }
});

export default router;
