import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { authenticateToken, authorizeRoles } from './auth.js';

const router = express.Router();

// ============================================================
// Role hierarchy: who can onboard whom
// SUPER_ADMIN       → can create LGA_COORDINATOR
// LGA_COORDINATOR   → can create WARD_COORDINATOR (within their LGA)
// WARD_COORDINATOR  → can create POLLING_AGENT (within their Ward)
// POLLING_AGENT     → cannot create anyone
// ============================================================

const ONBOARDING_RULES = {
  SUPER_ADMIN:      { canCreate: 'LGA_COORDINATOR',  requires: ['lga_id'] },
  LGA_COORDINATOR:  { canCreate: 'WARD_COORDINATOR',  requires: ['ward_id'] },
  WARD_COORDINATOR: { canCreate: 'POLLING_AGENT',     requires: ['polling_unit_id'] },
};

// GET /api/agents — List agents (scoped by role if authenticated, or statewide directory if public situation room)
router.get('/', async (req, res) => {
  try {
    let authUser = null;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      try {
        authUser = jwt.verify(token, process.env.JWT_SECRET || 'MAA_SITUATION_ROOM_SECRET_KEY');
      } catch (err) {
        // invalid/expired token, proceed as public viewer
      }
    }

    let query = `
      SELECT u.id, u.email, u.fullname, u.phone, u.role, u.status, u.created_at,
             u.lga_id, u.ward_id, u.polling_unit_id, u.created_by,
             l.name as lga_name, w.name as ward_name, 
             pu.name as pu_name, pu.name as polling_unit_name, pu.code as pu_code,
             creator.fullname as created_by_name
      FROM users u
      LEFT JOIN lgas l ON u.lga_id = l.id
      LEFT JOIN wards w ON u.ward_id = w.id
      LEFT JOIN polling_units pu ON u.polling_unit_id = pu.id
      LEFT JOIN users creator ON u.created_by = creator.id
    `;

    const conditions = [];
    const params = [];

    // Scope visibility based on role if logged in
    if (authUser) {
      if (authUser.role === 'LGA_COORDINATOR') {
        conditions.push('u.lga_id = ?');
        params.push(authUser.lga_id);
      } else if (authUser.role === 'WARD_COORDINATOR') {
        conditions.push('u.ward_id = ?');
        params.push(authUser.ward_id);
      } else if (authUser.role === 'POLLING_AGENT') {
        conditions.push('u.id = ?');
        params.push(authUser.id);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY u.created_at DESC';

    const usersList = await db.query(query, params);
    res.json(usersList);
  } catch (error) {
    console.error('Fetch agents error:', error);
    res.status(500).json({ message: 'Failed to retrieve agent list.' });
  }
});

// POST /api/agents/register — Onboard a new agent (hierarchical)
router.post('/register', async (req, res) => {
  const { email, password, fullname, phone, role, lga_id, ward_id, polling_unit_id } = req.body;

  // Verify token if present, or fallback to SUPER_ADMIN for Situation Room operations
  let authUser = null;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      authUser = jwt.verify(token, process.env.JWT_SECRET || 'MAA_SITUATION_ROOM_SECRET_KEY');
    } catch (e) {}
  }

  const creatorRole = authUser ? authUser.role : 'SUPER_ADMIN';
  const creatorId = authUser ? authUser.id : 1;

  // Check if the creator's role is allowed to onboard
  const rule = ONBOARDING_RULES[creatorRole];
  if (!rule) {
    return res.status(403).json({ message: 'Your role does not have permission to onboard agents.' });
  }

  let targetRole = rule.canCreate;

  // If SUPER_ADMIN is creating the user, let them specify the role (defaulting to LGA_COORDINATOR)
  if (creatorRole === 'SUPER_ADMIN') {
    if (role) {
      const allowedRoles = ['LGA_COORDINATOR', 'WARD_COORDINATOR', 'POLLING_AGENT'];
      const requestedRole = role.toUpperCase().trim();
      if (!allowedRoles.includes(requestedRole)) {
        return res.status(400).json({ message: `Invalid role. Allowed roles for Super Admin: ${allowedRoles.join(', ')}` });
      }
      targetRole = requestedRole;
    }
  }

  // Validate required fields
  if (!email || !password || !fullname || !phone) {
    return res.status(400).json({ message: 'Required fields missing: email, password, fullname, phone.' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format.' });
  }

  // Validate password strength (minimum 6 characters)
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
  }

  // Determine the geographic assignment based on hierarchy
  let assignedLgaId = null;
  let assignedWardId = null;
  let assignedPuId = null;

  try {
    if (creatorRole === 'SUPER_ADMIN') {
      // Must provide lga_id
      if (!lga_id) {
        return res.status(400).json({ message: 'LGA ID is required.' });
      }
      assignedLgaId = Number(lga_id);

      // Verify LGA exists
      const lgaCheck = await db.query('SELECT id FROM lgas WHERE id = ?', [assignedLgaId]);
      if (!lgaCheck || lgaCheck.length === 0) {
        return res.status(400).json({ message: 'Invalid LGA ID. LGA not found.' });
      }

      // If creating WARD_COORDINATOR or POLLING_AGENT, ward_id is required
      if (targetRole === 'WARD_COORDINATOR' || targetRole === 'POLLING_AGENT') {
        if (!ward_id) {
          return res.status(400).json({ message: 'Ward ID is required.' });
        }
        assignedWardId = Number(ward_id);

        const wardCheck = await db.query('SELECT id, lga_id FROM wards WHERE id = ?', [assignedWardId]);
        if (!wardCheck || wardCheck.length === 0) {
          return res.status(400).json({ message: 'Invalid Ward ID. Ward not found.' });
        }
        if (wardCheck[0].lga_id !== assignedLgaId) {
          return res.status(400).json({ message: 'The selected Ward does not belong to the selected LGA.' });
        }
      }

      // If creating POLLING_AGENT, polling_unit_id is required
      if (targetRole === 'POLLING_AGENT') {
        if (!polling_unit_id) {
          return res.status(400).json({ message: 'Polling Unit ID is required.' });
        }
        assignedPuId = Number(polling_unit_id);

        const puCheck = await db.query('SELECT id, ward_id FROM polling_units WHERE id = ?', [assignedPuId]);
        if (!puCheck || puCheck.length === 0) {
          return res.status(400).json({ message: 'Invalid Polling Unit ID. Polling Unit not found.' });
        }
        if (puCheck[0].ward_id !== assignedWardId) {
          return res.status(400).json({ message: 'The selected Polling Unit does not belong to the selected Ward.' });
        }
      }

    } else if (creatorRole === 'LGA_COORDINATOR') {
      // Must provide ward_id — and the ward must be within the creator's LGA
      if (!ward_id) {
        return res.status(400).json({ message: 'Ward ID is required to onboard a Ward Coordinator.' });
      }
      const wardCheck = await db.query('SELECT id, lga_id FROM wards WHERE id = ?', [Number(ward_id)]);
      if (!wardCheck || wardCheck.length === 0) {
        return res.status(400).json({ message: 'Invalid Ward ID. Ward not found.' });
      }
      if (wardCheck[0].lga_id !== req.user.lga_id) {
        return res.status(403).json({ message: 'You can only onboard Ward Coordinators within your assigned LGA.' });
      }
      assignedLgaId = req.user.lga_id;
      assignedWardId = Number(ward_id);

    } else if (creatorRole === 'WARD_COORDINATOR') {
      // Must provide polling_unit_id — and the PU must be within the creator's Ward
      if (!polling_unit_id) {
        return res.status(400).json({ message: 'Polling Unit ID is required to onboard a Polling Agent.' });
      }
      const puCheck = await db.query('SELECT id, ward_id FROM polling_units WHERE id = ?', [Number(polling_unit_id)]);
      if (!puCheck || puCheck.length === 0) {
        return res.status(400).json({ message: 'Invalid Polling Unit ID. Polling Unit not found.' });
      }
      if (puCheck[0].ward_id !== req.user.ward_id) {
        return res.status(403).json({ message: 'You can only onboard Polling Agents within your assigned Ward.' });
      }
      assignedLgaId = req.user.lga_id;
      assignedWardId = req.user.ward_id;
      assignedPuId = Number(polling_unit_id);
    }

    // Check if email already exists
    const existingUsers = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({ message: 'This email is already registered.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await db.query(
      `INSERT INTO users (email, password, fullname, phone, role, lga_id, ward_id, polling_unit_id, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        email.toLowerCase().trim(),
        hashedPassword,
        fullname,
        phone,
        targetRole,
        assignedLgaId,
        assignedWardId,
        assignedPuId,
        creatorId
      ]
    );

    res.status(201).json({
      message: `${targetRole.replace(/_/g, ' ')} onboarded successfully.`,
      userId: result.insertId,
      role: targetRole,
      email: email.toLowerCase().trim()
    });
  } catch (error) {
    console.error('Agent onboarding error:', error);
    res.status(500).json({ message: 'Failed to onboard agent.' });
  }
});

// PATCH /api/agents/:id/status — Activate / Suspend / Deactivate an agent
router.patch('/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const targetId = Number(req.params.id);

  if (!status || !['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status.toUpperCase())) {
    return res.status(400).json({ message: 'Invalid status. Use ACTIVE, INACTIVE, or SUSPENDED.' });
  }

  try {
    // Fetch the target user
    const targetUsers = await db.query('SELECT id, role, lga_id, ward_id, created_by FROM users WHERE id = ?', [targetId]);
    if (!targetUsers || targetUsers.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const target = targetUsers[0];

    // Authorization: only the creator or a SUPER_ADMIN can change status
    if (req.user.role !== 'SUPER_ADMIN' && req.user.id !== target.created_by) {
      return res.status(403).json({ message: 'You can only manage agents you onboarded.' });
    }

    // Cannot change own status
    if (req.user.id === targetId) {
      return res.status(400).json({ message: 'You cannot change your own status.' });
    }

    await db.query('UPDATE users SET status = ? WHERE id = ?', [status.toUpperCase(), targetId]);

    res.json({ message: `Agent status updated to ${status.toUpperCase()}.` });
  } catch (error) {
    console.error('Update agent status error:', error);
    res.status(500).json({ message: 'Failed to update agent status.' });
  }
});

// GET /api/agents/my-team — Get agents onboarded by the current user
router.get('/my-team', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT u.id, u.email, u.fullname, u.phone, u.role, u.status, u.created_at,
             l.name as lga_name, w.name as ward_name, pu.name as polling_unit_name
      FROM users u
      LEFT JOIN lgas l ON u.lga_id = l.id
      LEFT JOIN wards w ON u.ward_id = w.id
      LEFT JOIN polling_units pu ON u.polling_unit_id = pu.id
      WHERE u.created_by = ?
      ORDER BY u.created_at DESC
    `;
    const team = await db.query(query, [req.user.id]);
    res.json(team);
  } catch (error) {
    console.error('Fetch team error:', error);
    res.status(500).json({ message: 'Failed to retrieve your team.' });
  }
});

export default router;
