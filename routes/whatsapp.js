import express from 'express';
import fs from 'fs';
import QRCode from 'qrcode';
import { getWhatsAppStatus, startWhatsApp, stopWhatsApp } from '../services/whatsapp.js';

const router = express.Router();

/**
 * GET /api/whatsapp/status
 * Returns connection state and base64 QR data URL for scanning in the portal UI
 */
router.get('/status', async (req, res) => {
  try {
    const status = getWhatsAppStatus();
    let qrDataUrl = status.qrDataUrl;
    if (!qrDataUrl && status.qrRaw) {
      try {
        qrDataUrl = await QRCode.toDataURL(status.qrRaw, { margin: 2, width: 280 });
      } catch (e) {
        qrDataUrl = null;
      }
    }
    return res.json({
      success: true,
      data: {
        ...status,
        qrDataUrl
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve WhatsApp status',
      error: err.message
    });
  }
});

/**
 * POST /api/whatsapp/start
 * Starts the WhatsApp Bot service on demand
 */
router.post('/start', async (req, res) => {
  try {
    startWhatsApp().catch((e) => console.error('Error starting WhatsApp on start request:', e));
    return res.json({
      success: true,
      message: 'WhatsApp Bot service activation initiated.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to start WhatsApp service',
      error: err.message
    });
  }
});

/**
 * POST /api/whatsapp/stop
 * Gracefully puts the WhatsApp Bot service into standby mode without clearing saved credentials
 */
router.post('/stop', (req, res) => {
  try {
    stopWhatsApp();
    return res.json({
      success: true,
      message: 'WhatsApp Bot service put in standby. Saved session credentials preserved.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to stop WhatsApp service',
      error: err.message
    });
  }
});

/**
 * POST /api/whatsapp/refresh
 * Triggers a fresh connection attempt / QR regeneration
 */
router.post('/refresh', async (req, res) => {
  try {
    startWhatsApp().catch((e) => console.error('Error starting WhatsApp on refresh:', e));
    return res.json({
      success: true,
      message: 'WhatsApp connection cycle initiated.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger WhatsApp refresh',
      error: err.message
    });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * Explicitly clears saved Baileys auth tokens and resets session
 */
router.post('/disconnect', (req, res) => {
  try {
    stopWhatsApp();
    if (fs.existsSync('auth_info_baileys')) {
      fs.rmSync('auth_info_baileys', { recursive: true, force: true });
    }
    return res.json({
      success: true,
      message: 'WhatsApp session credentials cleared. Service reset to standby.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to clear session credentials',
      error: err.message
    });
  }
});

export default router;

