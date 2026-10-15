/**
 * Directives API Routes
 * 
 * Cascading Directive System:
 *   Super Admin → Steering Committee → LGA Coordinators → Ward Agents → PU Agents
 * 
 * Also supports UPWARD reporting:
 *   PU Agent → Ward → LGA → Steering → Super Admin
 */
import express from 'express';
import db from '../config/db.js';
import { getWhatsAppSocket } from '../services/whatsapp.js';

const router = express.Router();

// ═══════════════════════════════════════════════════════
// Helper: Generate ref code
// ═══════════════════════════════════════════════════════
async function generateRefCode() {
  try {
    const rows = await db.query('SELECT COUNT(id) as count FROM directives');
    const count = (rows[0]?.count || 0) + 1;
    return `DIR-2027-${String(count).padStart(3, '0')}`;
  } catch {
    return `DIR-2027-${String(Date.now()).slice(-3)}`;
  }
}

// ═══════════════════════════════════════════════════════
// Helper: Format WhatsApp directive message
// ═══════════════════════════════════════════════════════
function formatDirectiveMessage(directive, fromTier, toTier) {
  const tierLabels = {
    SUPER_ADMIN: '🟢 Super Admin (Apex Command)',
    STEERING: '🔵 State Steering Committee',
    LGA: '🟡 LGA Coordinator',
    WARD: '🟠 Ward Supervisor',
    PU: '🔴 Polling Unit Agent'
  };

  const priorityEmojis = {
    URGENT: '🔴 URGENT',
    HIGH: '🟠 HIGH',
    MEDIUM: '🟡 MEDIUM',
    LOW: '🟢 LOW'
  };

  return `🟢 *APM YAN AKWATI STRATEGIC DIRECTIVE* 🟢\n\n` +
    `*From:* ${tierLabels[fromTier] || fromTier}\n` +
    `*To:* ${tierLabels[toTier] || toTier}\n` +
    `*Ref:* ${directive.ref_code}\n` +
    `*Priority:* ${priorityEmojis[directive.priority] || directive.priority}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *${directive.title}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${directive.description}\n\n` +
    (directive.target_per_pu ? `🎯 *Target:* ${directive.target_per_pu} per Polling Unit\n` : '') +
    (directive.deadline ? `⏰ *Deadline:* ${directive.deadline}\n` : '') +
    `\n✅ Reply *ACK* to acknowledge receipt\n` +
    `📊 Reply *PROGRESS 5* to report 5 completed\n` +
    `🚨 Reply *ISSUE [details]* to escalate a problem\n\n` +
    `_APM Bauchi 2027 • Hon. Dr. Yakubu Adamu Vanguard Command_`;
}

// ═══════════════════════════════════════════════════════
// Helper: Format upward field report message
// ═══════════════════════════════════════════════════════
function formatUpwardReport(response, directive) {
  const typeEmojis = {
    ACKNOWLEDGED: '✅ Acknowledged',
    PROGRESS_UPDATE: '📊 Progress Update',
    COMPLETED: '🎉 Completed',
    ISSUE: '🚨 Issue Escalated',
    FIELD_REPORT: '📋 Field Report'
  };

  return `📡 *FIELD REPORT (UPWARD)* 📡\n\n` +
    `*Type:* ${typeEmojis[response.response_type] || response.response_type}\n` +
    `*Directive:* ${directive.ref_code} - ${directive.title}\n` +
    `*From:* ${response.from_tier} Agent\n` +
    (response.lga_name ? `*LGA:* ${response.lga_name}\n` : '') +
    (response.ward_name ? `*Ward:* ${response.ward_name}\n` : '') +
    (response.pu_name ? `*PU:* ${response.pu_name}\n` : '') +
    (response.phone ? `*Phone:* ${response.phone}\n` : '') +
    `\n━━━━━━━━━━━━━━━━━━━━━\n` +
    `📝 ${response.message}\n` +
    (response.progress_count ? `📊 *Progress:* ${response.progress_count} completed\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `_${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}_`;
}

// ═══════════════════════════════════════════════════════
// POST /api/directives — Create new directive
// ═══════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    const { title, category, priority, description, target_per_pu, deadline, created_by } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Title and description are required.' });
    }

    const ref_code = await generateRefCode();

    const result = await db.query(
      `INSERT INTO directives (ref_code, title, category, priority, description, target_per_pu, deadline, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref_code, title, category || 'GENERAL', priority || 'MEDIUM', description, target_per_pu || 0, deadline || null, created_by || 1]
    );

    const newDirective = {
      id: result.insertId,
      ref_code,
      title,
      category: category || 'GENERAL',
      priority: priority || 'MEDIUM',
      description,
      target_per_pu: target_per_pu || 0,
      deadline: deadline || null,
      status: 'ACTIVE',
      created_at: new Date()
    };

    res.status(201).json({ success: true, data: newDirective, message: `Directive ${ref_code} created.` });
  } catch (error) {
    console.error('Create directive error:', error);
    res.status(500).json({ success: false, message: 'Failed to create directive.' });
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/directives — List all directives
// ═══════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const directives = await db.query(
      'SELECT * FROM directives ORDER BY created_at DESC'
    );

    // For each directive, count relays per tier and responses
    const enriched = [];
    for (const d of directives) {
      const relays = await db.query(
        'SELECT to_tier, delivery_status, COUNT(*) as count FROM directive_relays WHERE directive_id = ? GROUP BY to_tier, delivery_status',
        [d.id]
      );
      const responses = await db.query(
        'SELECT response_type, COUNT(*) as count FROM directive_responses WHERE directive_id = ? GROUP BY response_type',
        [d.id]
      );

      // Aggregate relay status per tier
      const relaySummary = {};
      for (const r of relays) {
        if (!relaySummary[r.to_tier]) relaySummary[r.to_tier] = { total: 0, sent: 0, delivered: 0, failed: 0 };
        relaySummary[r.to_tier].total += r.count;
        if (r.delivery_status === 'SENT' || r.delivery_status === 'DELIVERED' || r.delivery_status === 'READ') {
          relaySummary[r.to_tier].sent += r.count;
        }
        if (r.delivery_status === 'DELIVERED' || r.delivery_status === 'READ') {
          relaySummary[r.to_tier].delivered += r.count;
        }
        if (r.delivery_status === 'FAILED') {
          relaySummary[r.to_tier].failed += r.count;
        }
      }

      // Aggregate response counts
      const responseSummary = {};
      let totalProgress = 0;
      for (const resp of responses) {
        responseSummary[resp.response_type] = resp.count;
        if (resp.response_type === 'PROGRESS_UPDATE' || resp.response_type === 'COMPLETED') {
          totalProgress += resp.count;
        }
      }

      enriched.push({
        ...d,
        relay_summary: relaySummary,
        response_summary: responseSummary,
        total_responses: totalProgress
      });
    }

    res.json({ success: true, data: enriched });
  } catch (error) {
    console.error('List directives error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch directives.' });
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/directives/:id — Get single directive with full details
// ═══════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const directives = await db.query('SELECT * FROM directives WHERE id = ?', [req.params.id]);
    if (!directives || directives.length === 0) {
      return res.status(404).json({ success: false, message: 'Directive not found.' });
    }

    const directive = directives[0];

    const relays = await db.query(
      'SELECT * FROM directive_relays WHERE directive_id = ? ORDER BY relayed_at DESC',
      [directive.id]
    );

    const responses = await db.query(
      'SELECT * FROM directive_responses WHERE directive_id = ? ORDER BY responded_at DESC',
      [directive.id]
    );

    res.json({
      success: true,
      data: {
        ...directive,
        relays,
        responses
      }
    });
  } catch (error) {
    console.error('Get directive error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch directive.' });
  }
});

// ═══════════════════════════════════════════════════════
// POST /api/directives/:id/relay — Cascade to next tier
// Sends WhatsApp messages to targets at the next tier
// ═══════════════════════════════════════════════════════
router.post('/:id/relay', async (req, res) => {
  try {
    const { from_tier, to_tier, targets, relayed_by } = req.body;
    // targets: [{ phone, name, lga, ward }]

    if (!from_tier || !to_tier || !targets || !Array.isArray(targets)) {
      return res.status(400).json({ success: false, message: 'from_tier, to_tier, and targets[] are required.' });
    }

    const directives = await db.query('SELECT * FROM directives WHERE id = ?', [req.params.id]);
    if (!directives || directives.length === 0) {
      return res.status(404).json({ success: false, message: 'Directive not found.' });
    }

    const directive = directives[0];
    const sock = getWhatsAppSocket();
    const results = [];

    for (const target of targets) {
      let deliveryStatus = 'PENDING';
      let deliveryMethod = 'PORTAL';

      // Try to send via WhatsApp if phone is provided and bot is connected
      if (target.phone && sock) {
        try {
          const cleanPhone = target.phone.replace(/\D/g, '');
          let jid = '';
          if (cleanPhone.startsWith('0')) {
            jid = `234${cleanPhone.slice(1)}@s.whatsapp.net`;
          } else if (cleanPhone.startsWith('234')) {
            jid = `${cleanPhone}@s.whatsapp.net`;
          } else if (cleanPhone.startsWith('+234')) {
            jid = `${cleanPhone.slice(1)}@s.whatsapp.net`;
          } else {
            jid = `${cleanPhone}@s.whatsapp.net`;
          }

          const message = formatDirectiveMessage(directive, from_tier, to_tier);
          await sock.sendMessage(jid, { text: message });
          deliveryStatus = 'SENT';
          deliveryMethod = 'WHATSAPP';
          console.log(`📤 Directive ${directive.ref_code} sent via WhatsApp to ${target.name} (${target.phone})`);
        } catch (waErr) {
          console.error(`❌ WhatsApp send failed for ${target.phone}:`, waErr.message);
          deliveryStatus = 'FAILED';
          deliveryMethod = 'WHATSAPP';
        }
      }

      // Log the relay in the database
      await db.query(
        `INSERT INTO directive_relays (directive_id, from_tier, to_tier, relayed_by, target_phone, target_name, target_lga, target_ward, delivery_method, delivery_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [directive.id, from_tier, to_tier, relayed_by || 1, target.phone || null, target.name || null, target.lga || null, target.ward || null, deliveryMethod, deliveryStatus]
      );

      results.push({
        name: target.name,
        phone: target.phone,
        status: deliveryStatus,
        method: deliveryMethod
      });
    }

    const sentCount = results.filter(r => r.status === 'SENT').length;
    const failedCount = results.filter(r => r.status === 'FAILED').length;

    res.json({
      success: true,
      message: `Directive relayed to ${results.length} targets. ${sentCount} via WhatsApp, ${failedCount} failed.`,
      data: results
    });
  } catch (error) {
    console.error('Relay directive error:', error);
    res.status(500).json({ success: false, message: 'Failed to relay directive.' });
  }
});

// ═══════════════════════════════════════════════════════
// POST /api/directives/:id/respond — Submit upward response/report
// Used by field agents (any tier) to send info UP the chain
// ═══════════════════════════════════════════════════════
router.post('/:id/respond', async (req, res) => {
  try {
    const { user_id, from_tier, response_type, message, progress_count, lga_name, ward_name, pu_name, phone, escalate_up } = req.body;

    if (!from_tier || !response_type || !message) {
      return res.status(400).json({ success: false, message: 'from_tier, response_type, and message are required.' });
    }

    const directives = await db.query('SELECT * FROM directives WHERE id = ?', [req.params.id]);
    if (!directives || directives.length === 0) {
      return res.status(404).json({ success: false, message: 'Directive not found.' });
    }

    const directive = directives[0];

    // Save the response
    await db.query(
      `INSERT INTO directive_responses (directive_id, user_id, from_tier, response_type, message, progress_count, lga_name, ward_name, pu_name, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [directive.id, user_id || null, from_tier, response_type, message, progress_count || 0, lga_name || null, ward_name || null, pu_name || null, phone || null]
    );

    const responseData = {
      from_tier,
      response_type,
      message,
      progress_count: progress_count || 0,
      lga_name,
      ward_name,
      pu_name,
      phone
    };

    // If escalate_up is true, send WhatsApp notification up the chain
    if (escalate_up) {
      const sock = getWhatsAppSocket();
      if (sock) {
        // Determine who to send upward to based on from_tier
        const upwardTargets = await getUpwardTargets(from_tier, lga_name);
        const reportMsg = formatUpwardReport(responseData, directive);

        for (const target of upwardTargets) {
          try {
            const cleanPhone = target.phone.replace(/\D/g, '');
            let jid = '';
            if (cleanPhone.startsWith('0')) {
              jid = `234${cleanPhone.slice(1)}@s.whatsapp.net`;
            } else if (cleanPhone.startsWith('234')) {
              jid = `${cleanPhone}@s.whatsapp.net`;
            } else {
              jid = `${cleanPhone}@s.whatsapp.net`;
            }
            await sock.sendMessage(jid, { text: reportMsg });
            console.log(`📡 Upward report sent to ${target.name} (${target.phone})`);
          } catch (e) {
            console.error(`❌ Failed to send upward report to ${target.phone}:`, e.message);
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Response recorded. ${escalate_up ? 'Escalated up the chain.' : ''}`,
      data: responseData
    });
  } catch (error) {
    console.error('Respond to directive error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit response.' });
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/directives/:id/responses — Get all upward reports for a directive
// ═══════════════════════════════════════════════════════
router.get('/:id/responses', async (req, res) => {
  try {
    const responses = await db.query(
      'SELECT * FROM directive_responses WHERE directive_id = ? ORDER BY responded_at DESC',
      [req.params.id]
    );
    res.json({ success: true, data: responses });
  } catch (error) {
    console.error('Fetch responses error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch responses.' });
  }
});

// ═══════════════════════════════════════════════════════
// GET /api/directives/:id/progress — Aggregated progress by LGA
// ═══════════════════════════════════════════════════════
router.get('/:id/progress', async (req, res) => {
  try {
    const responses = await db.query(
      `SELECT lga_name, 
              SUM(progress_count) as total_progress, 
              COUNT(*) as total_reports,
              COUNT(CASE WHEN response_type = 'COMPLETED' THEN 1 END) as completed_count,
              COUNT(CASE WHEN response_type = 'ISSUE' THEN 1 END) as issue_count
       FROM directive_responses 
       WHERE directive_id = ? AND lga_name IS NOT NULL
       GROUP BY lga_name`,
      [req.params.id]
    );
    res.json({ success: true, data: responses });
  } catch (error) {
    console.error('Fetch progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch progress.' });
  }
});

// ═══════════════════════════════════════════════════════
// PUT /api/directives/:id — Update directive status
// ═══════════════════════════════════════════════════════
router.put('/:id', async (req, res) => {
  try {
    const { status, title, description, priority, deadline } = req.body;

    if (status) {
      await db.query('UPDATE directives SET status = ? WHERE id = ?', [status, req.params.id]);
    }
    if (title) {
      await db.query('UPDATE directives SET title = ? WHERE id = ?', [title, req.params.id]);
    }
    if (description) {
      await db.query('UPDATE directives SET description = ? WHERE id = ?', [description, req.params.id]);
    }

    res.json({ success: true, message: 'Directive updated.' });
  } catch (error) {
    console.error('Update directive error:', error);
    res.status(500).json({ success: false, message: 'Failed to update directive.' });
  }
});

// ═══════════════════════════════════════════════════════
// Helper: Get upward targets based on tier
// PU → Ward → LGA → Steering → Super Admin
// ═══════════════════════════════════════════════════════
async function getUpwardTargets(fromTier, lgaName) {
  const targets = [];

  try {
    if (fromTier === 'PU' || fromTier === 'WARD') {
      // Send to LGA Coordinator
      if (lgaName) {
        const coords = await db.query(
          'SELECT * FROM lga_coordinators WHERE lga_name = ?',
          [lgaName]
        );
        if (coords && coords.length > 0) {
          targets.push({ name: coords[0].name, phone: coords[0].phone });
        }
      }
    }

    if (fromTier === 'PU' || fromTier === 'WARD' || fromTier === 'LGA') {
      // Send to Steering Committee members supervising this LGA
      if (lgaName) {
        const steering = await db.query(
          `SELECT * FROM state_steering_committee WHERE supervising_lgas LIKE ?`,
          [`%${lgaName}%`]
        );
        for (const s of steering) {
          targets.push({ name: s.name, phone: s.phone });
        }
      }
    }

    // Always send critical reports to Super Admin
    const admins = await db.query(
      `SELECT fullname, phone FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'`
    );
    for (const admin of admins) {
      targets.push({ name: admin.fullname, phone: admin.phone });
    }
  } catch (e) {
    console.error('Error getting upward targets:', e.message);
  }

  return targets;
}

export default router;
