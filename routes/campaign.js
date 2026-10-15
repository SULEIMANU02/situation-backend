import express from 'express';
import db from '../config/db.js';
import { authenticateToken } from './auth.js';
import { getFacebookSentiment } from '../services/facebookScraper.js';

const router = express.Router();

// Get Facebook sentiment report
router.get('/facebook-sentiment', authenticateToken, async (req, res) => {
  try {
    const bypassCache = req.query.bypassCache === 'true';
    const report = await getFacebookSentiment(bypassCache);
    res.json(report);
  } catch (error) {
    console.error('Fetch Facebook sentiment error:', error);
    res.status(500).json({ message: 'Failed to retrieve Facebook sentiment analysis.' });
  }
});

// Get all campaign reports
router.get('/', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        cr.*, 
        l.name as lga_name, 
        u.fullname as reported_by_name,
        u.role as reporter_role,
        w.name as ward_name,
        pu.name as polling_unit_name,
        pu.code as polling_unit_code
      FROM campaign_reports cr
      JOIN lgas l ON cr.lga_id = l.id
      JOIN users u ON cr.reported_by = u.id
      LEFT JOIN wards w ON u.ward_id = w.id
      LEFT JOIN polling_units pu ON u.polling_unit_id = pu.id
      ORDER BY cr.created_at DESC
    `;
    const reports = await db.query(query);
    res.json(reports);
  } catch (error) {
    console.error('Fetch campaign reports error:', error);
    res.status(500).json({ message: 'Failed to retrieve campaign activities.' });
  }
});

// Create campaign report
router.post('/', authenticateToken, async (req, res) => {
  let { title, description, activity_type, lga_id, attendee_count, sentiment } = req.body;

  // Auto-assign lga_id from user profile if they have a fixed LGA assignment
  if (req.user.role === 'POLLING_AGENT' || req.user.role === 'WARD_COORDINATOR' || req.user.role === 'LGA_COORDINATOR') {
    lga_id = req.user.lga_id;
  }

  if (!title || !description || !activity_type || !lga_id) {
    return res.status(400).json({ message: 'Missing fields: title, description, activity_type, and lga_id are required.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO campaign_reports (title, description, activity_type, lga_id, attendee_count, sentiment, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description,
        activity_type,
        Number(lga_id),
        Number(attendee_count || 0),
        sentiment || 'NEUTRAL',
        req.user.id
      ]
    );

    res.status(201).json({
      message: 'Campaign report logged successfully.',
      reportId: result.insertId
    });
  } catch (error) {
    console.error('Create campaign report error:', error);
    res.status(500).json({ message: 'Failed to create campaign activity record.' });
  }
});

export default router;
