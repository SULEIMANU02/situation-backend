import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import db from '../config/db.js';
import { parseWhatsAppMessage, transcribeAudio } from './groq.js';
import { sendSecurityAlert } from '../routes/ussd.js';

import QRCode from 'qrcode';

// Module-level WhatsApp socket and status references
let whatsAppSocket = null;
let currentQr = null;
let currentQrDataUrl = null;
let isConnected = false;
let connectedUser = null;
let isServiceActive = process.env.ENABLE_WHATSAPP === 'true';

/**
 * Returns the active WhatsApp socket instance.
 * Used by directives routes to send messages via the connected bot.
 */
export function getWhatsAppSocket() {
  return whatsAppSocket;
}

/**
 * Gracefully stops the active WhatsApp socket without deleting credentials.
 * Sets the service to standby mode.
 */
export function stopWhatsApp() {
  isServiceActive = false;
  if (whatsAppSocket) {
    try {
      whatsAppSocket.end(undefined);
    } catch (e) {}
    whatsAppSocket = null;
  }
  isConnected = false;
  currentQr = null;
  currentQrDataUrl = null;
  connectedUser = null;
  console.log('🛑 WhatsApp service stopped and put into STANDBY mode.');
}

/**
 * Returns the current live status and QR data URL for the web portal UI.
 */
export function getWhatsAppStatus() {
  return {
    isEnabled: isServiceActive,
    isConnected,
    connectedUser,
    hasQr: Boolean(currentQr),
    qrDataUrl: currentQrDataUrl,
    qrRaw: currentQr
  };
}

// In-memory store for pending confirmations
const pendingConfirmations = new Map();

// Helper to normalize phone numbers for searching
function getPhoneVariants(phone) {
  const clean = phone.replace(/[^\d+]/g, ''); // keep only digits and +
  const variants = [clean];
  if (clean.startsWith('234')) {
    variants.push('0' + clean.slice(3));
    variants.push('+' + clean);
  } else if (clean.startsWith('+234')) {
    variants.push('0' + clean.slice(4));
    variants.push(clean.slice(1));
  } else if (clean.startsWith('0')) {
    variants.push('234' + clean.slice(1));
    variants.push('+234' + clean.slice(1));
  }
  return [...new Set(variants)];
}

/**
 * Initializes and starts the Baileys WhatsApp bot.
 */
export async function startWhatsApp() {
  isServiceActive = true;
  console.log('🤖 Starting WhatsApp Bot Service for APM Situation Room...');

  // Fetch the latest WhatsApp Web version to avoid 405 errors
  let version;
  try {
    const versionInfo = await fetchLatestBaileysVersion();
    version = versionInfo.version;
    console.log(`📱 Using WhatsApp Web v${version.join('.')}, isLatest: ${versionInfo.isLatest}`);
  } catch (err) {
    console.warn('⚠️ Could not fetch latest WA version, using default:', err.message);
  }

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    ...(version && { version })
  });

  let isReconnecting = false;

  sock.ev.on('connection.update', async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update || {};
      if (qr) {
        currentQr = qr;
        isConnected = false;
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 280 });
        } catch (qrErr) {
          currentQrDataUrl = null;
        }
        console.log(`📱 [WhatsApp] Live pairing QR generated (${new Date().toLocaleTimeString()}). Viewable in portal at /portal.`);
      }
      if (connection === 'close') {
        isConnected = false;
        whatsAppSocket = null;
        const errObj = lastDisconnect?.error;
        const statusCode = errObj?.output?.statusCode || errObj?.output?.payload?.statusCode;
        const isExplicitLogout = statusCode === DisconnectReason.loggedOut;
        const shouldReconnect = isServiceActive && !isExplicitLogout;
        const errMsg = errObj?.message || 'Connection closed';

        console.log(`🔌 WhatsApp connection closed: ${errMsg} (Status Code: ${statusCode || 'unknown'}). Reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          if (!isReconnecting) {
            isReconnecting = true;
            const delay = statusCode === 408 ? 60000 : 8000;
            if (statusCode === 408) {
              console.log('⏳ QR code timed out. Cooling down for 60s before next refresh attempt.');
            }
            setTimeout(() => {
              isReconnecting = false;
              if (isServiceActive) {
                startWhatsApp().catch((err) => {
                  console.error('❌ Error restarting WhatsApp service:', err?.message || err);
                });
              }
            }, delay);
          }
        } else {
          currentQr = null;
          currentQrDataUrl = null;
          connectedUser = null;
          if (isExplicitLogout) {
            console.log('🚪 WhatsApp session logged out from phone. Clearing session credentials...');
            try {
              if (fs.existsSync('auth_info_baileys')) {
                fs.rmSync('auth_info_baileys', { recursive: true, force: true });
              }
              console.log('🗑️ Session credentials cleared.');
            } catch (rmErr) {
              console.error('❌ Failed to clear credentials directory:', rmErr?.message || rmErr);
            }
          } else {
            console.log('⏸️ WhatsApp service stopped or on standby. Session credentials safely preserved.');
          }
        }
      } else if (connection === 'open') {
        console.log('===================================================');
        console.log('✅ Connected to WhatsApp successfully!');
        console.log('===================================================');
        whatsAppSocket = sock;
        isConnected = true;
        isReconnecting = false;
        currentQr = null;
        currentQrDataUrl = null;
        connectedUser = sock.user || null;
      }
    } catch (handlerErr) {
      console.error('⚠️ Error in WhatsApp connection.update handler:', handlerErr?.message || handlerErr);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    console.log('📩 [Baileys Event] messages.upsert triggered:', JSON.stringify(m, null, 2));
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (msg.key.fromMe || !msg.message) continue;

      const senderJid = msg.key.remoteJid;
      const phoneJid = msg.key.remoteJidAlt || senderJid;

      // Group messages end with @g.us, ignore them
      if (senderJid.endsWith('@g.us')) {
        console.log(`ℹ️ Ignoring group message from ${senderJid}`);
        continue;
      }

      // Check if it's a direct message (either @s.whatsapp.net or @lid)
      const isDirect = senderJid.endsWith('@s.whatsapp.net') || senderJid.endsWith('@lid');
      if (!isDirect) {
        console.log(`ℹ️ Ignoring non-direct message from ${senderJid}`);
        continue;
      }

      const phone = phoneJid.split('@')[0];

      const isImage = !!msg.message.imageMessage;
      const isVideo = !!msg.message.videoMessage;
      const isAudio = !!msg.message.audioMessage;

      let fileUrl = null;
      let text = '';

      if (isImage || isVideo || isAudio) {
        console.log(`📥 Processing media attachment from ${phone}...`);
        try {
          const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), rekey: false }
          );

          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          let ext = 'bin';
          let mimetype = 'application/octet-stream';

          if (isImage) {
            ext = 'jpg';
            mimetype = msg.message.imageMessage?.mimetype || 'image/jpeg';
          } else if (isVideo) {
            ext = 'mp4';
            mimetype = msg.message.videoMessage?.mimetype || 'video/mp4';
          } else if (isAudio) {
            mimetype = msg.message.audioMessage?.mimetype || 'audio/ogg';
            ext = mimetype.split('/')[1]?.split(';')[0] || 'ogg';
          }

          const filename = `wa-${uniqueSuffix}.${ext}`;

          if (!fs.existsSync('./uploads')) {
            fs.mkdirSync('./uploads', { recursive: true });
          }

          const filePath = `./uploads/${filename}`;
          await fs.promises.writeFile(filePath, buffer);
          fileUrl = `/uploads/${filename}`;
          console.log(`💾 Media saved locally: ${filePath} (${fileUrl})`);

          if (isAudio) {
            console.log(`🎙️ Transcribing audio (${mimetype}) using Groq Whisper...`);
            text = await transcribeAudio(buffer, filename, mimetype);
            console.log(`🎙️ Groq Voice Transcript: "${text}"`);
          } else {
            text = (msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '').trim();
          }
        } catch (mediaErr) {
          console.error('❌ Failed to download and process media message:', mediaErr);
          await sock.sendMessage(senderJid, {
            text: '⚠️ Failed to process media attachment. Please try sending it again.'
          });
          continue;
        }
      } else {
        text = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          ''
        ).trim();
      }

      if (!text && !isImage && !isVideo) {
        console.log(`ℹ️ Ignoring empty message from ${phone}`);
        continue;
      }

      console.log(`💬 WhatsApp from ${phone}: "${text || (isImage ? '[Photo]' : isVideo ? '[Video]' : '')}"`);

      try {
        // 1. Check if the user is registered in the database
        const variants = getPhoneVariants(phone);
        const placeholders = variants.map(() => '?').join(',');
        const users = await db.query(
          `SELECT * FROM users WHERE phone IN (${placeholders}) AND status = 'ACTIVE'`,
          variants
        );

        if (users && users.length > 0) {
          const user = users[0];
          await handleRegisteredUser(sock, senderJid, text, user, fileUrl, isImage, isVideo);
        } else {
          await handleUnregisteredUser(sock, senderJid, text, phone, fileUrl, isImage, isVideo);
        }
      } catch (error) {
        console.error('Error handling WhatsApp message:', error);
        await sock.sendMessage(senderJid, {
          text: '❌ Sorry, an error occurred on our server while processing your message. Please try again later.'
        });
      }
    }
  });
}

/**
 * Handles incoming messages from registered agents.
 * If media (photo/video) is sent, prompts agent whether it is a Result Sheet or Incident Report,
 * then guides them through confirming/supplying details before routing to the database.
 */
async function handleRegisteredUser(sock, senderJid, text, user, fileUrl = null, isImage = false, isVideo = false) {
  const input = (text || '').trim();

  // Resolve polling unit name and hierarchy
  let puName = 'Assigned Polling Unit';
  let lgaName = null;
  let wardName = null;
  if (user.polling_unit_id) {
    const pus = await db.query('SELECT name, code FROM polling_units WHERE id = ?', [user.polling_unit_id]);
    if (pus && pus.length > 0) {
      puName = `${pus[0].name} (${pus[0].code})`;
    }
  }
  if (user.lga_id) {
    const lgas = await db.query('SELECT name FROM lgas WHERE id = ?', [user.lga_id]);
    if (lgas && lgas.length > 0) lgaName = lgas[0].name;
  }
  if (user.ward_id) {
    const wards = await db.query('SELECT name FROM wards WHERE id = ?', [user.ward_id]);
    if (wards && wards.length > 0) wardName = wards[0].name;
  }

  // Determine user tier from role
  const tierMap = {
    'SUPER_ADMIN': 'SUPER_ADMIN',
    'LGA_COORDINATOR': 'LGA',
    'WARD_COORDINATOR': 'WARD',
    'POLLING_AGENT': 'PU'
  };
  const userTier = tierMap[user.role] || 'PU';

  // ═══════════════════════════════════════
  // 1. PHOTO OR VIDEO RECEIVED
  // Intercept immediately: Ask sender if it's a Result Sheet or Incident Evidence
  // ═══════════════════════════════════════
  if (isImage || isVideo) {
    pendingConfirmations.set(senderJid, {
      state: 'AWAITING_MEDIA_TYPE',
      fileUrl,
      caption: input,
      isImage,
      isVideo,
      puName,
      lgaName,
      wardName,
      timestamp: Date.now()
    });

    await sock.sendMessage(senderJid, {
      text: `📸 *Photo Received!*\n\nAssalamu Alaikum *${user.fullname}*!\nPlease tell us where to send this photo:\n\n1️⃣ *Result* (reply *1*) — Official Result Sheet (Form EC8A)\n2️⃣ *Incident* (reply *2*) — Incident / Violation / Emergency Evidence\n\n━━━━━━━━━━━━━━━━━━━━━\n👉 Reply *1* for Result Sheet\n👉 Reply *2* for Incident Report\n❌ Reply *Cancel* to discard`
    });
    return;
  }

  // ═══════════════════════════════════════
  // 2. CHECK PENDING INTERACTIVE SESSIONS
  // ═══════════════════════════════════════
  const pending = pendingConfirmations.get(senderJid);
  if (pending) {
    const rawClean = input.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Universal Cancel Handler
    if (rawClean === 'cancel' || rawClean === 'abort' || rawClean === 'discard' || (rawClean === 'no' && pending.state === 'AWAITING_MEDIA_TYPE')) {
      pendingConfirmations.delete(senderJid);
      await sock.sendMessage(senderJid, {
        text: '❌ *Cancelled.* The photo and operation have been discarded.'
      });
      return;
    }

    // STATE A: Sender is deciding whether photo is a Result Sheet or Incident Evidence
    if (pending.state === 'AWAITING_MEDIA_TYPE') {
      const isResult = rawClean === '1' || rawClean === 'result' || rawClean === 'results' || rawClean === 'sheet' || rawClean === 'ec8a' || rawClean === 'sakmako' || rawClean.includes('result') || rawClean.includes('sheet');
      const isIncident = rawClean === '2' || rawClean === 'incident' || rawClean === 'inc' || rawClean === 'incidents' || rawClean === 'evidence' || rawClean === 'fada' || rawClean === 'matsala' || rawClean === 'emergency' || rawClean === 'violence' || rawClean.includes('incident') || rawClean.includes('evidence');

      if (isResult) {
        // Selected RESULT SHEET
        let parsedResult = null;
        if (pending.caption && pending.caption.length > 0) {
          try {
            const parsed = await parseWhatsAppMessage(pending.caption);
            if (parsed && parsed.type === 'result' && parsed.data) {
              const { apm = 0, apc = 0, pdp = 0, prp = 0, adc = 0, invalid = 0 } = parsed.data;
              if ((apm + apc + pdp + prp + adc + invalid) > 0) {
                parsedResult = parsed.data;
              }
            }
          } catch (e) {
            console.log('Error parsing caption for results:', e.message);
          }
        }

        if (parsedResult) {
          // Votes were already provided in the image caption
          const total = (parsedResult.apm || 0) + (parsedResult.apc || 0) + (parsedResult.pdp || 0) + (parsedResult.prp || 0) + (parsedResult.adc || 0) + (parsedResult.invalid || 0);
          pendingConfirmations.set(senderJid, {
            state: 'CONFIRM_RESULT',
            type: 'result',
            data: parsedResult,
            fileUrl: pending.fileUrl,
            isImageOrVideo: true,
            puName: pending.puName
          });

          await sock.sendMessage(senderJid, {
            text: `📊 *Please confirm these results from your sheet:*\n\n📍 *PU:* ${pending.puName}\n━━━━━━━━━━━━━━━━━━━━━\n🗳️ *APM:* ${parsedResult.apm}\n🗳️ *APC:* ${parsedResult.apc}\n🗳️ *PDP:* ${parsedResult.pdp}\n🗳️ *PRP:* ${parsedResult.prp}\n🗳️ *ADC:* ${parsedResult.adc}\n⚠️ *Invalid:* ${parsedResult.invalid}\n📊 *Total:* ${total}\n📸 *Result Sheet:* Attached\n━━━━━━━━━━━━━━━━━━━━━\n\n✅ Reply *Yes* to submit to Situation Room\n❌ Reply *No* to cancel`
          });
        } else {
          // Caption was empty or had no numbers -> transition to AWAITING_RESULT_SCORES
          pendingConfirmations.set(senderJid, {
            state: 'AWAITING_RESULT_SCORES',
            fileUrl: pending.fileUrl,
            isImageOrVideo: true,
            puName: pending.puName
          });

          await sock.sendMessage(senderJid, {
            text: `📊 *Result Sheet Photo Stored!*\n\n📍 *PU:* ${pending.puName}\n📸 Official sheet saved.\n\nPlease reply with the official vote tallies from this Form EC8A sheet:\n\n*Format:*\n*APM [votes], APC [votes], PDP [votes], PRP [votes], ADC [votes], Invalid [votes]*\n\n*Example:*\n_APM 145, APC 90, PDP 50, PRP 5, ADC 2, Invalid 1_\n\n_(You can type in English, Hausa, or send a voice note)_`
          });
        }
        return;
      }

      if (isIncident) {
        // Selected INCIDENT EVIDENCE
        let parsedIncident = null;
        if (pending.caption && pending.caption.length > 3) {
          try {
            const parsed = await parseWhatsAppMessage(pending.caption);
            if (parsed && parsed.type === 'incident' && parsed.incident) {
              parsedIncident = parsed.incident;
            } else {
              parsedIncident = { category: 'OTHER', description: pending.caption };
            }
          } catch (e) {
            parsedIncident = { category: 'OTHER', description: pending.caption };
          }
        }

        if (parsedIncident) {
          // Description already provided in caption
          pendingConfirmations.set(senderJid, {
            state: 'CONFIRM_INCIDENT',
            type: 'incident',
            incident: parsedIncident,
            fileUrl: pending.fileUrl,
            isImageOrVideo: true,
            puName: pending.puName
          });

          await sock.sendMessage(senderJid, {
            text: `🚨 *Please confirm this incident report:*\n\n📍 *PU:* ${pending.puName}\n━━━━━━━━━━━━━━━━━━━━━\n📂 *Category:* ${parsedIncident.category.replace(/_/g, ' ')}\n📝 *Description:* ${parsedIncident.description}\n📸 *Evidence:* Photo Attached\n━━━━━━━━━━━━━━━━━━━━━\n\n✅ Reply *Yes* to dispatch to Situation Room & Security\n❌ Reply *No* to cancel`
          });
        } else {
          // Transition to AWAITING_INCIDENT_DETAILS
          pendingConfirmations.set(senderJid, {
            state: 'AWAITING_INCIDENT_DETAILS',
            fileUrl: pending.fileUrl,
            isImageOrVideo: true,
            puName: pending.puName
          });

          await sock.sendMessage(senderJid, {
            text: `🚨 *Incident Evidence Photo Stored!*\n\n📍 *PU:* ${pending.puName}\n📸 Photo evidence saved.\n\nPlease describe what happened at this polling unit:\n\n*Example:*\n_"Armed political thugs disrupted voting and tried to snatch ballot box"_\nor\n_"BVAS machine stopped working since 11am"_\n\n_(You can describe in English, Hausa, or send a voice note)_`
          });
        }
        return;
      }

      // Neither 1 nor 2 recognized
      await sock.sendMessage(senderJid, {
        text: `❓ *Please reply with 1 or 2:*\n\n1️⃣ Reply *1* or *Result* — Official Result Sheet (Form EC8A)\n2️⃣ Reply *2* or *Incident* — Incident / Violation Evidence\n\n❌ Reply *Cancel* to discard.`
      });
      return;
    }

    // STATE B: Awaiting vote scores for result sheet
    if (pending.state === 'AWAITING_RESULT_SCORES') {
      try {
        const parsed = await parseWhatsAppMessage(input);
        if (parsed && parsed.type === 'result' && parsed.data) {
          const { apm = 0, apc = 0, pdp = 0, prp = 0, adc = 0, invalid = 0 } = parsed.data;
          const total = apm + apc + pdp + prp + adc + invalid;

          pendingConfirmations.set(senderJid, {
            state: 'CONFIRM_RESULT',
            type: 'result',
            data: { apm, apc, pdp, prp, adc, invalid },
            fileUrl: pending.fileUrl,
            isImageOrVideo: true,
            puName: pending.puName
          });

          await sock.sendMessage(senderJid, {
            text: `📊 *Please confirm these results from your sheet:*\n\n📍 *PU:* ${pending.puName}\n━━━━━━━━━━━━━━━━━━━━━\n🗳️ *APM:* ${apm}\n🗳️ *APC:* ${apc}\n🗳️ *PDP:* ${pdp}\n🗳️ *PRP:* ${prp}\n🗳️ *ADC:* ${adc}\n⚠️ *Invalid:* ${invalid}\n📊 *Total:* ${total}\n📸 *Result Sheet:* Attached\n━━━━━━━━━━━━━━━━━━━━━\n\n✅ Reply *Yes* to submit to Situation Room\n❌ Reply *No* to re-enter`
          });
          return;
        }
      } catch (e) {
        console.error('Error parsing scores in AWAITING_RESULT_SCORES:', e);
      }

      await sock.sendMessage(senderJid, {
        text: `⚠️ Could not understand vote counts.\n\nPlease reply like this:\n*APM 145, APC 90, PDP 50, PRP 5, ADC 2, Invalid 1*\n\nOr reply *Cancel* to discard.`
      });
      return;
    }

    // STATE C: Awaiting incident description for evidence photo
    if (pending.state === 'AWAITING_INCIDENT_DETAILS') {
      let category = 'OTHER';
      let description = input;
      try {
        const parsed = await parseWhatsAppMessage(input);
        if (parsed && parsed.type === 'incident' && parsed.incident) {
          category = parsed.incident.category || 'OTHER';
          description = parsed.incident.description || input;
        }
      } catch (e) {
        console.error('Error parsing incident details:', e);
      }

      pendingConfirmations.set(senderJid, {
        state: 'CONFIRM_INCIDENT',
        type: 'incident',
        incident: { category, description },
        fileUrl: pending.fileUrl,
        isImageOrVideo: true,
        puName: pending.puName
      });

      await sock.sendMessage(senderJid, {
        text: `🚨 *Please confirm this incident report:*\n\n📍 *PU:* ${pending.puName}\n━━━━━━━━━━━━━━━━━━━━━\n📂 *Category:* ${category.replace(/_/g, ' ')}\n📝 *Description:* ${description}\n📸 *Evidence:* Photo Attached\n━━━━━━━━━━━━━━━━━━━━━\n\n✅ Reply *Yes* to submit & dispatch security\n❌ Reply *No* to re-enter`
      });
      return;
    }

    // STATE D: Final Confirmation of Result (Yes / No)
    if (pending.state === 'CONFIRM_RESULT' || pending.type === 'result') {
      const reply = rawClean;
      if (reply === 'yes' || reply === 'confirm' || reply === 'ok' || reply === 'submit' || reply === 'y') {
        try {
          await saveElectionResult(pending.data, user, pending.fileUrl, true);
          pendingConfirmations.delete(senderJid);
          const r = pending.data;
          const total = (r.apm || 0) + (r.apc || 0) + (r.pdp || 0) + (r.prp || 0) + (r.adc || 0) + (r.invalid || 0);
          await sock.sendMessage(senderJid, {
            text: `✅ *Election Results Submitted Successfully!*\n📸 *Result sheet image saved to Situation Room database.*\n\n📍 *PU:* ${pending.puName}\n🗳️ *APM:* ${r.apm}\n🗳️ *APC:* ${r.apc}\n🗳️ *PDP:* ${r.pdp}\n🗳️ *PRP:* ${r.prp}\n🗳️ *ADC:* ${r.adc}\n⚠️ *Invalid:* ${r.invalid}\n📊 *Total:* ${total}\n\nJazakallahu Khairan, Comrade! 🙏`
          });
        } catch (err) {
          console.error('Error saving confirmed result:', err);
          pendingConfirmations.delete(senderJid);
          await sock.sendMessage(senderJid, { text: '❌ Server error while saving results. Please try again.' });
        }
        return;
      } else if (reply === 'no' || reply === 'cancel' || reply === 'retry' || reply === 'n') {
        pendingConfirmations.delete(senderJid);
        await sock.sendMessage(senderJid, { text: '❌ *Cancelled.* Results submission discarded.' });
        return;
      }
    }

    // STATE E: Final Confirmation of Incident (Yes / No)
    if (pending.state === 'CONFIRM_INCIDENT' || pending.type === 'incident') {
      const reply = rawClean;
      if (reply === 'yes' || reply === 'confirm' || reply === 'ok' || reply === 'submit' || reply === 'y') {
        try {
          await saveIncidentReport(pending.incident, user, pending.fileUrl, true, pending.puName);
          pendingConfirmations.delete(senderJid);
          await sock.sendMessage(senderJid, {
            text: `🚨 *Incident Report Logged & Dispatched!*${pending.fileUrl ? '\n📸 *Evidence photo saved.*' : ''}\n\n📍 *PU:* ${pending.puName}\n📂 *Category:* ${pending.incident.category.replace(/_/g, ' ')}\n📝 *Description:* ${pending.incident.description}\n👮 *Status:* Dispatched to security teams & Situation Room map.\n\nJazakallahu Khairan, Comrade! 🙏`
          });
        } catch (err) {
          console.error('Error saving confirmed incident:', err);
          pendingConfirmations.delete(senderJid);
          await sock.sendMessage(senderJid, { text: '❌ Server error while saving incident. Please try again.' });
        }
        return;
      } else if (reply === 'no' || reply === 'cancel' || reply === 'retry' || reply === 'n') {
        pendingConfirmations.delete(senderJid);
        await sock.sendMessage(senderJid, { text: '❌ *Cancelled.* Incident report discarded.' });
        return;
      }
    }
  }

  // ═══════════════════════════════════════
  // 3. DIRECTIVE COMMANDS: ACK, PROGRESS, ISSUE, REPORT
  // ═══════════════════════════════════════
  const upperInput = input.toUpperCase();

  if (upperInput === 'ACK' || upperInput === 'ACKNOWLEDGED' || upperInput === 'RECEIVED') {
    // Acknowledge the latest active directive
    try {
      const activeDirectives = await db.query(
        "SELECT * FROM directives WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1"
      );
      if (activeDirectives && activeDirectives.length > 0) {
        const directive = activeDirectives[0];
        await db.query(
          `INSERT INTO directive_responses (directive_id, user_id, from_tier, response_type, message, lga_name, ward_name, pu_name, phone)
           VALUES (?, ?, ?, 'ACKNOWLEDGED', ?, ?, ?, ?, ?)`,
          [directive.id, user.id, userTier, `${user.fullname} acknowledged receipt.`, lgaName, wardName, puName, user.phone]
        );
        await sock.sendMessage(senderJid, {
          text: `✅ *Acknowledged!*\n\nYour acknowledgement for directive *${directive.ref_code}* has been recorded and sent up the chain.\n\n📋 *${directive.title}*\n\nJazakallahu Khairan, Comrade! 🙏`
        });
      } else {
        await sock.sendMessage(senderJid, { text: 'ℹ️ No active directives found to acknowledge.' });
      }
    } catch (e) {
      console.error('ACK handler error:', e);
      await sock.sendMessage(senderJid, { text: '❌ Error recording acknowledgement. Please try again.' });
    }
    return;
  }

  if (upperInput.startsWith('PROGRESS ') || upperInput.startsWith('PROGRESS:')) {
    // Report progress: "PROGRESS 5" or "PROGRESS: 5 beneficiaries registered"
    try {
      const parts = input.replace(/^progress[:\s]+/i, '').trim();
      const numberMatch = parts.match(/^(\d+)/);
      const count = numberMatch ? parseInt(numberMatch[1]) : 0;
      const details = parts.replace(/^\d+\s*/, '').trim() || `${count} completed`;

      const activeDirectives = await db.query(
        "SELECT * FROM directives WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1"
      );
      if (activeDirectives && activeDirectives.length > 0) {
        const directive = activeDirectives[0];
        await db.query(
          `INSERT INTO directive_responses (directive_id, user_id, from_tier, response_type, message, progress_count, lga_name, ward_name, pu_name, phone)
           VALUES (?, ?, ?, 'PROGRESS_UPDATE', ?, ?, ?, ?, ?, ?)`,
          [directive.id, user.id, userTier, `${user.fullname}: ${details}`, count, lgaName, wardName, puName, user.phone]
        );

        // Send upward notification to LGA coordinator & steering
        await escalateUpward(sock, directive, {
          from_tier: userTier,
          response_type: 'PROGRESS_UPDATE',
          message: `${user.fullname} reports: ${details}`,
          progress_count: count,
          lga_name: lgaName,
          ward_name: wardName,
          pu_name: puName,
          phone: user.phone
        });

        await sock.sendMessage(senderJid, {
          text: `📊 *Progress Recorded!*\n\nDirective: *${directive.ref_code}*\n📈 Progress: ${count} completed\n📝 ${details}\n\nYour update has been sent to your LGA Coordinator and Steering Committee. ✓✓`
        });
      }
    } catch (e) {
      console.error('PROGRESS handler error:', e);
      await sock.sendMessage(senderJid, { text: '❌ Error recording progress. Please try again.' });
    }
    return;
  }

  if (upperInput.startsWith('ISSUE ') || upperInput.startsWith('ISSUE:') || upperInput.startsWith('ESCALATE ')) {
    // Escalate an issue upward: "ISSUE no materials available at PU"
    try {
      const issueDetails = input.replace(/^(issue|escalate)[:\s]+/i, '').trim();
      const activeDirectives = await db.query(
        "SELECT * FROM directives WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1"
      );
      if (activeDirectives && activeDirectives.length > 0) {
        const directive = activeDirectives[0];
        await db.query(
          `INSERT INTO directive_responses (directive_id, user_id, from_tier, response_type, message, lga_name, ward_name, pu_name, phone)
           VALUES (?, ?, ?, 'ISSUE', ?, ?, ?, ?, ?)`,
          [directive.id, user.id, userTier, `🚨 ${user.fullname}: ${issueDetails}`, lgaName, wardName, puName, user.phone]
        );

        // Escalate upward immediately
        await escalateUpward(sock, directive, {
          from_tier: userTier,
          response_type: 'ISSUE',
          message: `🚨 ${user.fullname}: ${issueDetails}`,
          lga_name: lgaName,
          ward_name: wardName,
          pu_name: puName,
          phone: user.phone
        });

        await sock.sendMessage(senderJid, {
          text: `🚨 *Issue Escalated!*\n\nYour report has been sent directly to your LGA Coordinator, Steering Committee, and Super Admin.\n\n📝 ${issueDetails}\n\nA response team will reach out shortly. Stay safe, Comrade! 🙏`
        });
      }
    } catch (e) {
      console.error('ISSUE handler error:', e);
      await sock.sendMessage(senderJid, { text: '❌ Error escalating issue. Please try again.' });
    }
    return;
  }

  if (upperInput.startsWith('REPORT ') || upperInput.startsWith('REPORT:')) {
    // General field report sent upward: "REPORT huge crowd at rally venue"
    try {
      const reportDetails = input.replace(/^report[:\s]+/i, '').trim();
      const activeDirectives = await db.query(
        "SELECT * FROM directives WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1"
      );
      if (activeDirectives && activeDirectives.length > 0) {
        const directive = activeDirectives[0];
        await db.query(
          `INSERT INTO directive_responses (directive_id, user_id, from_tier, response_type, message, lga_name, ward_name, pu_name, phone)
           VALUES (?, ?, ?, 'FIELD_REPORT', ?, ?, ?, ?, ?)`,
          [directive.id, user.id, userTier, `📋 ${user.fullname}: ${reportDetails}`, lgaName, wardName, puName, user.phone]
        );

        // Send upward
        await escalateUpward(sock, directive, {
          from_tier: userTier,
          response_type: 'FIELD_REPORT',
          message: `📋 ${user.fullname}: ${reportDetails}`,
          lga_name: lgaName,
          ward_name: wardName,
          pu_name: puName,
          phone: user.phone
        });

        await sock.sendMessage(senderJid, {
          text: `📋 *Field Report Submitted!*\n\n📝 ${reportDetails}\n\nYour report has been forwarded up the command chain. Thank you, Comrade! ✓✓`
        });
      }
    } catch (e) {
      console.error('REPORT handler error:', e);
      await sock.sendMessage(senderJid, { text: '❌ Error submitting report. Please try again.' });
    }
    return;
  }

  // ═══════════════════════════════════════
  // 4. PARSE STANDARD TEXT MESSAGE WITH AI
  // ═══════════════════════════════════════
  try {
    const parsed = await parseWhatsAppMessage(input);
    console.log('🤖 AI Parsed:', JSON.stringify(parsed));

    if (parsed.type === 'result') {
      const { apm = 0, apc = 0, pdp = 0, prp = 0, adc = 0, invalid = 0 } = parsed.data || {};
      const total = apm + apc + pdp + prp + adc + invalid;

      pendingConfirmations.set(senderJid, {
        state: 'CONFIRM_RESULT',
        type: 'result',
        data: { apm, apc, pdp, prp, adc, invalid },
        fileUrl: null,
        isImageOrVideo: false,
        puName
      });

      await sock.sendMessage(senderJid, {
        text: `📊 *Please confirm these results:*\n\n📍 *PU:* ${puName}\n━━━━━━━━━━━━━━━━━━━━━\n🗳️ *APM:* ${apm}\n🗳️ *APC:* ${apc}\n🗳️ *PDP:* ${pdp}\n🗳️ *PRP:* ${prp}\n🗳️ *ADC:* ${adc}\n⚠️ *Invalid:* ${invalid}\n📊 *Total:* ${total}\n━━━━━━━━━━━━━━━━━━━━━\n\n✅ Reply *Yes* to submit\n❌ Reply *No* to cancel`
      });

    } else if (parsed.type === 'incident') {
      const { category = 'OTHER', description = input } = parsed.incident || {};

      pendingConfirmations.set(senderJid, {
        state: 'CONFIRM_INCIDENT',
        type: 'incident',
        incident: { category, description },
        fileUrl: null,
        isImageOrVideo: false,
        puName
      });

      await sock.sendMessage(senderJid, {
        text: `🚨 *Please confirm this incident report:*\n\n📍 *PU:* ${puName}\n━━━━━━━━━━━━━━━━━━━━━\n📂 *Category:* ${category.replace(/_/g, ' ')}\n📝 *Description:* ${description}\n━━━━━━━━━━━━━━━━━━━━━\n\n✅ Reply *Yes* to submit\n❌ Reply *No* to cancel`
      });

    } else {
      await sock.sendMessage(senderJid, {
        text: `Assalamu Alaikum *${user.fullname}*! 👋\n\n🏛️ *APM Situation Room Bauchi*\n📍 *Your PU:* ${puName}\n\n━━━━━━━━━━━━━━━━━━━━━\n📋 *How to use this bot:*\n━━━━━━━━━━━━━━━━━━━━━\n\n📸 *Send a Photo*: The bot will ask if it's an official Result Sheet or Incident Evidence, and guide you!\n\n🗳️ *To submit results via text*, just type:\n_"APM 145, APC 90, PDP 50, PRP 5, ADC 2, Invalid 1"_\n\n🚨 *To report an incident via text*, just describe it:\n_"Thugs are disrupting voting at my polling unit"_\n\n📡 *DIRECTIVE COMMANDS:*\n✅ *ACK* — Acknowledge a received directive\n📊 *PROGRESS 5* — Report 5 completed for current directive\n🚨 *ISSUE [details]* — Escalate a problem up the chain\n📋 *REPORT [details]* — Send field intelligence upward\n\nYou can also send a *photo*, *video*, or *voice note*! 📸🎤`
      });
    }
  } catch (err) {
    console.error('AI parsing error:', err.message);
    await sock.sendMessage(senderJid, {
      text: `Assalamu Alaikum *${user.fullname}*! 👋\n\n🏛️ *APM Situation Room Bauchi*\n📍 *Your PU:* ${puName}\n\n━━━━━━━━━━━━━━━━━━━━━\n📋 *How to use this bot:*\n━━━━━━━━━━━━━━━━━━━━━\n\n📸 *Send a Photo*: The bot will ask if it is a Result Sheet or Incident Evidence!\n\n🗳️ *To submit results*, type:\n_"APM 145, APC 90, PDP 50, PRP 5, ADC 2, Invalid 1"_\n\n🚨 *To report an incident*, describe it:\n_"Thugs are disrupting voting at my polling unit"_\n\n📡 *DIRECTIVE COMMANDS:*\n✅ *ACK* — Acknowledge directive\n📊 *PROGRESS 5* — Report progress\n🚨 *ISSUE [details]* — Escalate problem\n\nYou can also send a *photo*, *video*, or *voice note*! 📸🎤`
    });
  }
}

/**
 * Saves election results to the database.
 */
async function saveElectionResult(data, user, fileUrl, isImageOrVideo) {
  const { apm, apc, pdp, prp, adc, invalid } = data;
  const total = (apm || 0) + (apc || 0) + (pdp || 0) + (prp || 0) + (adc || 0) + (invalid || 0);

  const puId = user.polling_unit_id || 1;
  const existing = await db.query('SELECT id FROM election_results WHERE polling_unit_id = ?', [puId]);
  if (existing && existing.length > 0) {
    let updateQuery = `
      UPDATE election_results 
      SET apm_votes = ?, apc_votes = ?, pdp_votes = ?, prp_votes = ?, adc_votes = ?, invalid_votes = ?, total_votes = ?, submitted_by = ?
    `;
    const params = [apm, apc, pdp, prp, adc, invalid, total, user.id];
    if (fileUrl && isImageOrVideo) {
      updateQuery += `, result_sheet_url = ?`;
      params.push(fileUrl);
    }
    updateQuery += ` WHERE polling_unit_id = ?`;
    params.push(puId);
    await db.query(updateQuery, params);
  } else {
    await db.query(
      `INSERT INTO election_results (polling_unit_id, apm_votes, apc_votes, pdp_votes, prp_votes, adc_votes, invalid_votes, total_votes, result_sheet_url, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [puId, apm, apc, pdp, prp, adc, invalid, total, (fileUrl && isImageOrVideo) ? fileUrl : null, user.id]
    );
  }
}

/**
 * Saves an incident report to the database.
 */
async function saveIncidentReport(incident, user, fileUrl, isImageOrVideo, puName) {
  const { category, description } = incident;
  const incidentTitle = `WhatsApp Report: ${category.replace(/_/g, ' ')}`;

  const lgaId = user.lga_id || 1;
  const wardId = user.ward_id || null;
  const puId = user.polling_unit_id || null;

  await db.query(
    `INSERT INTO incidents (title, description, category, lga_id, ward_id, polling_unit_id, reported_by, image_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
    [incidentTitle, description, category, lgaId, wardId, puId, user.id, (fileUrl && isImageOrVideo) ? fileUrl : null]
  );

  // Trigger high priority alerts
  if (category === 'VIOLENCE' || category === 'VOTE_BUYING') {
    sendSecurityAlert(category, puName, user.fullname, user.phone).catch(err => {
      console.error('Failed to dispatch incident security alert:', err);
    });
  }
}

/**
 * Handles incoming messages from unregistered users.
 */
async function handleUnregisteredUser(sock, senderJid, text, phone, fileUrl = null, isImage = false, isVideo = false) {
  if (isImage || isVideo) {
    pendingConfirmations.set(senderJid, {
      state: 'UNREGISTERED_INCIDENT_PHOTO',
      fileUrl,
      caption: text || '',
      phone,
      timestamp: Date.now()
    });

    await sock.sendMessage(senderJid, {
      text: `📸 *Photo Received!*\n\nAssalamu Alaikum!\nYou are not registered as an official APM polling agent, but you can submit this photo as *Citizen Incident / Emergency Evidence*.\n\n👉 Please reply describing what happened and the Polling Unit / LGA location.\n_(Note: Official Result Sheets must be submitted by accredited agents.)_\n\n❌ Reply *Cancel* to discard.`
    });
    return;
  }

  const pending = pendingConfirmations.get(senderJid);
  if (pending && pending.state === 'UNREGISTERED_INCIDENT_PHOTO') {
    const rawInput = (text || '').trim();
    if (rawInput.toLowerCase() === 'cancel') {
      pendingConfirmations.delete(senderJid);
      await sock.sendMessage(senderJid, { text: '❌ *Photo discarded.*' });
      return;
    }

    try {
      const parsed = await parseWhatsAppMessage(rawInput);
      const category = (parsed?.type === 'incident' && parsed?.incident?.category) ? parsed.incident.category : 'OTHER';
      const description = `Citizen WhatsApp Report (+${phone}): ${parsed?.incident?.description || rawInput}`;

      const adminRows = await db.query("SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY id ASC LIMIT 1");
      const adminId = adminRows[0]?.id || 1;

      await db.query(
        `INSERT INTO incidents (title, description, category, lga_id, ward_id, polling_unit_id, reported_by, image_url, status)
         VALUES (?, ?, ?, 1, NULL, NULL, ?, ?, 'PENDING')`,
        ['Citizen WhatsApp Report: ' + category.replace(/_/g, ' '), description, category, adminId, pending.fileUrl]
      );

      pendingConfirmations.delete(senderJid);

      await sock.sendMessage(senderJid, {
        text: `🚨 *Citizen Incident Report Received!*\n📸 Evidence photo attached.\n👮 Dispatched to Situation Room Security Monitor.\n\nThank you for helping safeguard the election! 🙏`
      });
      return;
    } catch (e) {
      console.error('Error logging citizen incident:', e);
    }
  }

  await sock.sendMessage(senderJid, {
    text: `🚫 *Access Denied*\n\nYou are not registered as an active field agent for the *APM Situation Room Bauchi*.\n\nPlease contact your LGA coordinator or the situation room admin to get registered.`
  });
}

/**
 * Escalates a field response upward through the command chain via WhatsApp.
 * PU → Ward Coordinator → LGA Coordinator → Steering Committee → Super Admin
 */
async function escalateUpward(sock, directive, responseData) {
  const { from_tier, response_type, message, lga_name, ward_name, pu_name, phone } = responseData;

  const typeEmojis = {
    ACKNOWLEDGED: '✅ Acknowledged',
    PROGRESS_UPDATE: '📊 Progress Update',
    COMPLETED: '🎉 Completed',
    ISSUE: '🚨 Issue Escalated',
    FIELD_REPORT: '📋 Field Report'
  };

  const reportMsg = `📡 *FIELD REPORT (UPWARD)* 📡\n\n` +
    `*Type:* ${typeEmojis[response_type] || response_type}\n` +
    `*Directive:* ${directive.ref_code} - ${directive.title}\n` +
    `*From:* ${from_tier} Agent\n` +
    (lga_name ? `*LGA:* ${lga_name}\n` : '') +
    (ward_name ? `*Ward:* ${ward_name}\n` : '') +
    (pu_name ? `*PU:* ${pu_name}\n` : '') +
    (phone ? `*Phone:* ${phone}\n` : '') +
    `\n━━━━━━━━━━━━━━━━━━━━━\n` +
    `📝 ${message}\n` +
    (responseData.progress_count ? `📊 *Progress:* ${responseData.progress_count} completed\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━`;

  const targets = [];

  try {
    // Get upward targets based on tier
    if ((from_tier === 'PU' || from_tier === 'WARD') && lga_name) {
      // Send to LGA Coordinator
      const coords = await db.query('SELECT * FROM lga_coordinators WHERE lga_name = ?', [lga_name]);
      if (coords && coords.length > 0) {
        targets.push(coords[0].phone);
      }
    }

    if ((from_tier === 'PU' || from_tier === 'WARD' || from_tier === 'LGA') && lga_name) {
      // Send to Steering Committee members supervising this LGA
      const steering = await db.query(
        'SELECT * FROM state_steering_committee WHERE supervising_lgas LIKE ?',
        [`%${lga_name}%`]
      );
      for (const s of steering) {
        if (s.phone && !targets.includes(s.phone)) targets.push(s.phone);
      }
    }

    // For ISSUE type, always alert Super Admin
    if (response_type === 'ISSUE') {
      const admins = await db.query("SELECT phone FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'");
      for (const admin of admins) {
        if (admin.phone && !targets.includes(admin.phone)) targets.push(admin.phone);
      }
    }

    // Send to all upward targets
    for (const targetPhone of targets) {
      try {
        const cleanPhone = targetPhone.replace(/\D/g, '');
        let jid = '';
        if (cleanPhone.startsWith('0')) {
          jid = `234${cleanPhone.slice(1)}@s.whatsapp.net`;
        } else if (cleanPhone.startsWith('234')) {
          jid = `${cleanPhone}@s.whatsapp.net`;
        } else {
          jid = `${cleanPhone}@s.whatsapp.net`;
        }
        await sock.sendMessage(jid, { text: reportMsg });
        console.log(`📡 Upward report sent to ${targetPhone}`);
      } catch (e) {
        console.error(`❌ Failed to send upward to ${targetPhone}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Escalate upward error:', e.message);
  }
}

