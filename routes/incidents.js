import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Set up storage directory for multer uploads
const UPLOAD_DIR = './uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Unique filename: fieldname-timestamp.extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter (accept images only)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image uploads are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Get election incident reports (public friendly with conditional auth)
router.get('/', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  let isAuthorized = false;

  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'MAA_SITUATION_ROOM_SECRET_KEY_2026_APC_BAUCHI');
      isAuthorized = true;
    } catch (err) {
      // Fall through to public mode
    }
  }

  try {
    let query = `
      SELECT i.*, l.name as lga_name, w.name as ward_name, pu.name as polling_unit_name,
             ${isAuthorized ? 'u.fullname as reported_by_name' : "'Field Agent' as reported_by_name"}
      FROM incidents i
      LEFT JOIN lgas l ON i.lga_id = l.id
      LEFT JOIN wards w ON i.ward_id = w.id
      LEFT JOIN polling_units pu ON i.polling_unit_id = pu.id
      LEFT JOIN users u ON i.reported_by = u.id
    `;

    if (!isAuthorized) {
      query += ` WHERE i.status IN ('VERIFIED', 'RESOLVED') `;
    }

    query += ` ORDER BY i.created_at DESC `;

    const incidents = await db.query(query);
    res.json(incidents);
  } catch (error) {
    console.error('Fetch incidents error:', error);
    res.status(500).json({ message: 'Failed to retrieve election incidents.' });
  }
});

// Log a new incident (with optional image upload)
router.post('/', authenticateToken, upload.single('image'), async (req, res) => {
  let { title, description, category, lga_id, ward_id, polling_unit_id } = req.body;

  // If the reporter is a POLLING_AGENT, auto-assign their geographic boundaries
  if (req.user.role === 'POLLING_AGENT') {
    lga_id = req.user.lga_id;
    ward_id = req.user.ward_id;
    polling_unit_id = req.user.polling_unit_id;
  }

  // If the reporter is a WARD_COORDINATOR, auto-assign LGA/Ward, and validate PU
  if (req.user.role === 'WARD_COORDINATOR') {
    lga_id = req.user.lga_id;
    ward_id = req.user.ward_id;
    if (polling_unit_id) {
      const puCheck = await db.query('SELECT ward_id FROM polling_units WHERE id = ?', [Number(polling_unit_id)]);
      if (!puCheck || puCheck.length === 0 || puCheck[0].ward_id !== req.user.ward_id) {
        return res.status(403).json({ message: 'You can only report incidents for polling units within your ward.' });
      }
    }
  }

  if (!title || !description || !category || !lga_id) {
    return res.status(400).json({ message: 'Required fields missing: title, description, category, lga_id.' });
  }

  // Get image URL if uploaded
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const reportedBy = req.user.id;

  try {
    const result = await db.query(
      `INSERT INTO incidents (title, description, category, lga_id, ward_id, polling_unit_id, reported_by, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        title,
        description,
        category,
        Number(lga_id),
        ward_id ? Number(ward_id) : null,
        polling_unit_id ? Number(polling_unit_id) : null,
        reportedBy,
        imageUrl
      ]
    );

    res.status(201).json({
      message: 'Incident reported successfully. Security teams notified.',
      incidentId: result.insertId,
      imageUrl: imageUrl
    });
  } catch (error) {
    console.error('Create incident error:', error);
    res.status(500).json({ message: 'Failed to log incident report.' });
  }
});

// Update Incident Status (Super Admin / Coordinators only)
router.patch('/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const incidentId = req.params.id;

  if (!status || !['PENDING', 'VERIFIED', 'RESOLVED', 'REJECTED'].includes(status.toUpperCase())) {
    return res.status(400).json({ message: 'Invalid status update code.' });
  }

  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'LGA_COORDINATOR') {
    return res.status(403).json({ message: 'Forbidden. Only coordinators or admins can change incident status.' });
  }

  try {
    const result = await db.query(
      'UPDATE incidents SET status = ? WHERE id = ?',
      [status.toUpperCase(), Number(incidentId)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Incident report not found.' });
    }

    res.json({ message: `Incident report status successfully updated to ${status}.` });
  } catch (error) {
    console.error('Update incident error:', error);
    res.status(500).json({ message: 'Failed to update incident report.' });
  }
});

export default router;
