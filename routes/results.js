import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../config/db.js';
import { authenticateToken, authorizeRoles } from './auth.js';

const router = express.Router();

const UPLOAD_DIR = './uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'sheet-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Invalid sheet file type. Image files only.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB sheet limit
});

// Submit results for a Polling Unit (Enforced POLLING_AGENT only)
router.post('/submit', authenticateToken, authorizeRoles('POLLING_AGENT'), upload.single('result_sheet'), async (req, res) => {
  const { polling_unit_id, apm_votes, apc_votes, pdp_votes, prp_votes, adc_votes, invalid_votes } = req.body;

  if (!polling_unit_id || apm_votes === undefined) {
    return res.status(400).json({ message: 'Missing fields. Polling Unit ID and APM votes are required.' });
  }

  // Security check: Polling Agent must only submit for their assigned Polling Unit
  if (req.user.polling_unit_id && Number(polling_unit_id) !== req.user.polling_unit_id) {
    return res.status(403).json({ message: 'You are only authorized to submit results for your assigned Polling Unit.' });
  }

  const apm = Number(apm_votes);
  const apc = Number(apc_votes || 0);
  const pdp = Number(pdp_votes || 0);
  const prp = Number(prp_votes || 0);
  const adc = Number(adc_votes || 0);
  const invalid = Number(invalid_votes || 0);
  const total = apm + apc + pdp + prp + adc + invalid;
  const sheetUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const userId = req.user.id;

  try {
    // Check if result already exists for PU
    const existing = await db.query('SELECT id FROM election_results WHERE polling_unit_id = ?', [Number(polling_unit_id)]);

    if (existing && existing.length > 0) {
      // Update existing result
      let updateQuery = `
        UPDATE election_results
        SET apm_votes = ?, apc_votes = ?, pdp_votes = ?, prp_votes = ?, adc_votes = ?, invalid_votes = ?, total_votes = ?, submitted_by = ?
      `;
      const params = [apm, apc, pdp, prp, adc, invalid, total, userId];

      if (sheetUrl) {
        updateQuery += `, result_sheet_url = ?`;
        params.push(sheetUrl);
      }

      updateQuery += ` WHERE polling_unit_id = ?`;
      params.push(Number(polling_unit_id));

      await db.query(updateQuery, params);
      return res.json({ message: 'Election result updated successfully.' });
    }

    // Insert new result
    await db.query(
      `INSERT INTO election_results (polling_unit_id, apm_votes, apc_votes, pdp_votes, prp_votes, adc_votes, invalid_votes, total_votes, result_sheet_url, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(polling_unit_id), apm, apc, pdp, prp, adc, invalid, total, sheetUrl, userId]
    );

    res.status(201).json({ message: 'Election result submitted successfully.' });
  } catch (error) {
    console.error('Submit result error:', error);
    res.status(500).json({ message: 'Failed to record election result.' });
  }
});

// Get State-wide Summary of Results
router.get('/summary', async (req, res) => {
  try {
    // Total aggregate votes
    const sumQuery = `
      SELECT
        COALESCE(SUM(apm_votes), 0) as apm_total,
        COALESCE(SUM(apc_votes), 0) as apc_total,
        COALESCE(SUM(pdp_votes), 0) as pdp_total,
        COALESCE(SUM(prp_votes), 0) as prp_total,
        COALESCE(SUM(adc_votes), 0) as adc_total,
        COALESCE(SUM(invalid_votes), 0) as invalid_total,
        COALESCE(SUM(total_votes), 0) as grand_total
      FROM election_results
    `;
    const totals = await db.query(sumQuery);

    // Count reporting vs total polling units and registered voters
    const reportingPUsResult = await db.query('SELECT COUNT(id) as count FROM election_results');
    const totalPUsResult = await db.query('SELECT COUNT(id) as count, COALESCE(SUM(total_voters), 0) as total_registered_voters FROM polling_units');

    const reporting_pus = reportingPUsResult[0]?.count || 0;
    const total_pus = totalPUsResult[0]?.count || 5423; // Bauchi has 5,423 polling units in INEC register
    const total_registered_voters = Number(totalPUsResult[0]?.total_registered_voters || 2749268);

    res.json({
      totals: totals[0],
      reporting_pus,
      total_pus,
      total_registered_voters,
      reporting_percentage: total_pus > 0 ? (reporting_pus / total_pus) * 100 : 0
    });
  } catch (error) {
    console.error('Summary fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch result aggregates.' });
  }
});

// Get Results Grouped by LGA (for Map & Charts visualization)
router.get('/lgas', async (req, res) => {
  try {
    const query = `
      SELECT
        l.id as lga_id,
        l.name as lga_name,
        l.code as lga_code,
        l.latitude,
        l.longitude,
        COALESCE(SUM(er.apm_votes), 0) as apm_votes,
        COALESCE(SUM(er.apc_votes), 0) as apc_votes,
        COALESCE(SUM(er.pdp_votes), 0) as pdp_votes,
        COALESCE(SUM(er.prp_votes), 0) as prp_votes,
        COALESCE(SUM(er.adc_votes), 0) as adc_votes,
        COALESCE(SUM(er.invalid_votes), 0) as invalid_votes,
        COALESCE(SUM(er.total_votes), 0) as total_votes,
        COUNT(er.id) as reporting_pus,
        (SELECT COUNT(pu.id) FROM polling_units pu
         JOIN wards w ON pu.ward_id = w.id
         WHERE w.lga_id = l.id) as total_pus
      FROM lgas l
      LEFT JOIN wards w ON w.lga_id = l.id
      LEFT JOIN polling_units pu ON pu.ward_id = w.id
      LEFT JOIN election_results er ON er.polling_unit_id = pu.id
      GROUP BY l.id, l.name, l.code, l.latitude, l.longitude
    `;
    const lgaResults = await db.query(query);
    res.json(lgaResults);
  } catch (error) {
    console.error('LGA result fetch error:', error);
    res.status(500).json({ message: 'Failed to retrieve LGA result data.' });
  }
});

// Get detailed list of all polling unit submissions
router.get('/details', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT er.*, pu.name as polling_unit_name, pu.code as polling_unit_code, pu.total_voters,
             w.name as ward_name, w.id as ward_id,
             l.name as lga_name, l.id as lga_id,
             u.fullname as submitted_by_name
      FROM election_results er
      JOIN polling_units pu ON er.polling_unit_id = pu.id
      JOIN wards w ON pu.ward_id = w.id
      JOIN lgas l ON w.lga_id = l.id
      JOIN users u ON er.submitted_by = u.id
      ORDER BY er.updated_at DESC
    `;
    const details = await db.query(query);
    res.json(details);
  } catch (error) {
    console.error('Details results error:', error);
    res.status(500).json({ message: 'Failed to retrieve detailed results.' });
  }
});

// Helper routes: Get hierarchy (LGAs, Wards, PUs) for form dropdowns (Public directory access)
router.get('/hierarchy/lgas', async (req, res) => {
  try {
    const lgas = await db.query('SELECT * FROM lgas ORDER BY name ASC');
    res.json(lgas);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching LGAs.' });
  }
});

router.get('/hierarchy/wards/:lgaId', async (req, res) => {
  try {
    const wards = await db.query('SELECT * FROM wards WHERE lga_id = ? ORDER BY name ASC', [Number(req.params.lgaId)]);
    res.json(wards);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Wards.' });
  }
});

router.get('/hierarchy/pus/:wardId', async (req, res) => {
  try {
    const pus = await db.query('SELECT * FROM polling_units WHERE ward_id = ? ORDER BY name ASC', [Number(req.params.wardId)]);
    res.json(pus);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching Polling Units.' });
  }
});

// Add a new polling unit
router.post('/hierarchy/pus', authenticateToken, authorizeRoles('SUPER_ADMIN', 'LGA_COORDINATOR', 'WARD_COORDINATOR'), async (req, res) => {
  let { name, code, ward_id, total_voters } = req.body;
  total_voters = Number(total_voters || 0);

  if (!name || !code || !ward_id) {
    return res.status(400).json({ message: 'Name, code, and ward_id are required.' });
  }

  // Security constraints based on role
  if (req.user.role === 'WARD_COORDINATOR') {
    // A Ward Coordinator can only register PUs inside their assigned ward
    ward_id = req.user.ward_id;
  } else if (req.user.role === 'LGA_COORDINATOR') {
    // An LGA Coordinator can only register PUs inside wards belonging to their LGA
    try {
      const wardCheck = await db.query('SELECT id FROM wards WHERE id = ? AND lga_id = ?', [Number(ward_id), req.user.lga_id]);
      if (!wardCheck || wardCheck.length === 0) {
        return res.status(403).json({ message: 'You are only authorized to add polling units within your assigned LGA.' });
      }
    } catch (err) {
      console.error('LGA Coordinator ward check error:', err);
      return res.status(500).json({ message: 'Database error verifying ward.' });
    }
  }

  try {
    // Check code uniqueness
    const codeCheck = await db.query('SELECT id FROM polling_units WHERE code = ?', [code]);
    if (codeCheck && codeCheck.length > 0) {
      return res.status(400).json({ message: 'A Polling Unit with this code already exists.' });
    }

    const result = await db.query(
      'INSERT INTO polling_units (ward_id, name, code, total_voters) VALUES (?, ?, ?, ?)',
      [Number(ward_id), name, code, total_voters]
    );

    res.status(201).json({
      message: 'Polling Unit added successfully.',
      pollingUnitId: result.insertId
    });
  } catch (error) {
    console.error('Add Polling Unit error:', error);
    res.status(500).json({ message: 'Failed to add Polling Unit.' });
  }
});

// Remove a polling unit
router.delete('/hierarchy/pus/:id', authenticateToken, authorizeRoles('SUPER_ADMIN', 'LGA_COORDINATOR', 'WARD_COORDINATOR'), async (req, res) => {
  const puId = Number(req.params.id);

  try {
    // Fetch the polling unit ward_id and lga_id
    const puQuery = `
      SELECT pu.ward_id, w.lga_id
      FROM polling_units pu
      JOIN wards w ON pu.ward_id = w.id
      WHERE pu.id = ?
    `;
    const puRecords = await db.query(puQuery, [puId]);
    if (!puRecords || puRecords.length === 0) {
      return res.status(404).json({ message: 'Polling Unit not found.' });
    }

    const puWardId = puRecords[0].ward_id;
    const puLgaId = puRecords[0].lga_id;

    // Security constraints based on role
    if (req.user.role === 'WARD_COORDINATOR') {
      if (puWardId !== req.user.ward_id) {
        return res.status(403).json({ message: 'You are only authorized to delete polling units within your assigned ward.' });
      }
    } else if (req.user.role === 'LGA_COORDINATOR') {
      if (puLgaId !== req.user.lga_id) {
        return res.status(403).json({ message: 'You are only authorized to delete polling units within your assigned LGA.' });
      }
    }

    await db.query('DELETE FROM polling_units WHERE id = ?', [puId]);
    res.json({ message: 'Polling Unit deleted successfully.' });
  } catch (error) {
    console.error('Delete Polling Unit error:', error);
    res.status(500).json({ message: 'Failed to delete Polling Unit.' });
  }
});

export default router;
