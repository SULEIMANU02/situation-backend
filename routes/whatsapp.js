import express from 'express';
import QRCode from 'qrcode';
import { getWhatsAppStatus, startWhatsApp, stopWhatsApp } from '../services/whatsapp.js';
import { clearSession, hasSavedSession } from '../services/whatsappSessionStore.js';

const router = express.Router();

/**
 * GET /api/whatsapp/status
 * Returns connection state, one-time pairing status, and base64 QR data URL
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
    const saved = status.hasSavedSession || (await hasSavedSession('auth_info_baileys'));
    return res.json({
      success: true,
      data: {
        ...status,
        hasSavedSession: saved,
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
 * Explicitly clears saved Baileys auth tokens from MySQL and disk and resets session
 */
router.post('/disconnect', async (req, res) => {
  try {
    stopWhatsApp();
    await clearSession('auth_info_baileys');
    return res.json({
      success: true,
      message: 'WhatsApp session credentials permanently cleared from database and disk. Service reset.'
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

