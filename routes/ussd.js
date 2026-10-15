import express from 'express';
import db from '../config/db.js';

const router = express.Router();

// Helper to normalize phone numbers for searching
function getPhoneVariants(phone) {
  const clean = phone.replace(/[^\d+]/g, ''); // keep only digits and +
  const variants = [clean];
  if (clean.startsWith('+234')) {
    const local = '0' + clean.slice(4);
    const plain = clean.slice(4);
    variants.push(local, plain);
  } else if (clean.startsWith('234')) {
    const local = '0' + clean.slice(3);
    const plain = clean.slice(3);
    const intl = '+' + clean;
    variants.push(local, plain, intl);
  } else if (clean.startsWith('0')) {
    const intl = '+234' + clean.slice(1);
    const plain = clean.slice(1);
    variants.push(intl, plain);
  } else {
    const intl = '+234' + clean;
    const local = '0' + clean;
    variants.push(intl, local);
  }
  return [...new Set(variants)];
}

// Helper to find a Polling Unit by code (supports 05-XX-XX-XXX, 05/XX/XX/XXX, or 9-digit formats)
async function findPollingUnitByCode(codeStr) {
  const trimmed = codeStr.trim();
  const queryCodes = [trimmed];

  const numericOnly = trimmed.replace(/\D/g, '');
  if (numericOnly.length === 9) {
    const slashed = `${numericOnly.slice(0, 2)}/${numericOnly.slice(2, 4)}/${numericOnly.slice(4, 6)}/${numericOnly.slice(6, 9)}`;
    const hyphenated = `${numericOnly.slice(0, 2)}-${numericOnly.slice(2, 4)}-${numericOnly.slice(4, 6)}-${numericOnly.slice(6, 9)}`;
    queryCodes.push(slashed, hyphenated);
  } else if (trimmed.includes('/')) {
    queryCodes.push(trimmed.replace(/\//g, '-'));
  } else if (trimmed.includes('-')) {
    queryCodes.push(trimmed.replace(/-/g, '/'));
  }

  const placeholders = queryCodes.map(() => '?').join(',');
  const results = await db.query(
    `SELECT * FROM polling_units WHERE code IN (${placeholders})`,
    queryCodes
  );
  return results.length > 0 ? results[0] : null;
}

// SMS Sending Helper
export async function sendSms(to, message) {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  const senderId = process.env.AT_SENDER_ID;

  if (!username || !apiKey) {
    console.log(`\n================ MOCK SMS SENDER ================`);
    console.log(`To: ${to}`);
    console.log(`Message: "${message}"`);
    console.log(`=================================================\n`);
    return { success: true, mock: true };
  }

  try {
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('to', to);
    params.append('message', message);
    if (senderId) {
      params.append('from', senderId);
    }

    const response = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'apiKey': apiKey
      },
      body: params
    });

    const data = await response.json();
    console.log(`[SMS API Response]:`, JSON.stringify(data));
    return { success: true, data };
  } catch (error) {
    console.error('❌ Failed to send SMS via Africa\'s Talking:', error);
    return { success: false, error };
  }
}

// Security Alert Dispatcher
export async function sendSecurityAlert(category, pollingUnitName, agentName, agentPhone) {
  const securityNumbers = process.env.SECURITY_PHONE_NUMBERS;
  if (!securityNumbers) {
    console.log(`\n================ MOCK SMS ALERT BROADCAST ================`);
    console.log(`⚠️ No SECURITY_PHONE_NUMBERS configured in .env`);
    console.log(`Alert Category: ${category}`);
    console.log(`Polling Unit:   ${pollingUnitName}`);
    console.log(`Reported By:    ${agentName} (${agentPhone})`);
    console.log(`==========================================================\n`);
    return;
  }

  const message = `ALERT: Critical Incident (${category}) reported at ${pollingUnitName} by agent ${agentName} (${agentPhone}). Immediate response requested.`;
  const targets = securityNumbers.split(',').map(n => n.trim()).filter(Boolean);

  console.log(`📡 Dispatched alert message to ${targets.length} security recipient(s)...`);
  for (const target of targets) {
    await sendSms(target, message);
  }
}

// Core stateless transition engine
async function evaluateSession(parts, user, puName) {
  let state = 'MAIN_MENU';
  let data = {};
  let currentPartIndex = 0;

  while (currentPartIndex < parts.length) {
    const input = parts[currentPartIndex].trim();

    if (state === 'MAIN_MENU') {
      if (input === '1') {
        if (!user.polling_unit_id) {
          return { error: 'Your account is not assigned to a Polling Unit. Cannot submit results.' };
        }
        state = 'RESULT_APM';
      } else if (input === '2') {
        state = 'INCIDENT_CATEGORY';
      } else {
        return { error: 'Invalid option selected. Please start over.' };
      }
      currentPartIndex++;
    } 
    // Results submission path
    else if (state === 'RESULT_APM') {
      const val = parseInt(input);
      if (isNaN(val) || val < 0) return { error: 'Invalid votes count. Must be a number.' };
      data.apm_votes = val;
      state = 'RESULT_APC';
      currentPartIndex++;
    } else if (state === 'RESULT_APC') {
      const val = parseInt(input);
      if (isNaN(val) || val < 0) return { error: 'Invalid votes count. Must be a number.' };
      data.apc_votes = val;
      state = 'RESULT_PDP';
      currentPartIndex++;
    } else if (state === 'RESULT_PDP') {
      const val = parseInt(input);
      if (isNaN(val) || val < 0) return { error: 'Invalid votes count. Must be a number.' };
      data.pdp_votes = val;
      state = 'RESULT_PRP';
      currentPartIndex++;
    } else if (state === 'RESULT_PRP') {
      const val = parseInt(input);
      if (isNaN(val) || val < 0) return { error: 'Invalid votes count. Must be a number.' };
      data.prp_votes = val;
      state = 'RESULT_ADC';
      currentPartIndex++;
    } else if (state === 'RESULT_ADC') {
      const val = parseInt(input);
      if (isNaN(val) || val < 0) return { error: 'Invalid votes count. Must be a number.' };
      data.adc_votes = val;
      state = 'RESULT_INVALID';
      currentPartIndex++;
    } else if (state === 'RESULT_INVALID') {
      const val = parseInt(input);
      if (isNaN(val) || val < 0) return { error: 'Invalid votes count. Must be a number.' };
      data.invalid_votes = val;
      state = 'RESULT_CONFIRM';
      currentPartIndex++;
    } else if (state === 'RESULT_CONFIRM') {
      if (input === '1') {
        state = 'RESULT_SUBMITTED';
      } else if (input === '2') {
        state = 'RESULT_CANCELLED';
      } else {
        return { error: 'Invalid option. Select 1 to Confirm or 2 to Cancel.' };
      }
      currentPartIndex++;
    }
    // Incident report path
    else if (state === 'INCIDENT_CATEGORY') {
      const categories = ['VOTE_BUYING', 'VIOLENCE', 'EQUIPMENT_FAILURE', 'DELAY', 'OPPONENT_ACTIVITY', 'OTHER'];
      const catIdx = parseInt(input) - 1;
      if (catIdx >= 0 && catIdx < categories.length) {
        data.category = categories[catIdx];
        state = 'INCIDENT_DESC';
        currentPartIndex++;
      } else {
        return { error: 'Invalid category selection. Choose 1-6.' };
      }
    } else if (state === 'INCIDENT_DESC') {
      // Collect all inputs from this point, handling any potential '*' characters in description
      const remainingParts = parts.slice(currentPartIndex);
      if (remainingParts.length > 1 && (remainingParts[remainingParts.length - 1] === '1' || remainingParts[remainingParts.length - 1] === '2')) {
        // User saw confirmation screen and selected 1 or 2
        data.description = remainingParts.slice(0, -1).join('*').trim();
        const confirmCode = remainingParts[remainingParts.length - 1];
        if (confirmCode === '1') {
          state = 'INCIDENT_SUBMITTED';
        } else {
          state = 'INCIDENT_CANCELLED';
        }
        currentPartIndex += remainingParts.length;
      } else {
        // User just submitted the description
        data.description = remainingParts.join('*').trim();
        state = 'INCIDENT_CONFIRM';
        currentPartIndex += remainingParts.length;
      }
    } else if (state === 'INCIDENT_CONFIRM') {
      if (input === '1') {
        state = 'INCIDENT_SUBMITTED';
      } else if (input === '2') {
        state = 'INCIDENT_CANCELLED';
      } else {
        return { error: 'Invalid option. Select 1 to Confirm or 2 to Cancel.' };
      }
      currentPartIndex++;
    } else {
      currentPartIndex++;
    }
  }

  // Pre-fill PU details from the user's record
  if (user.polling_unit_id) {
    data.polling_unit_id = user.polling_unit_id;
    data.polling_unit_name = puName;
  }

  return { state, data };
}

// POST endpoint for USSD callback
router.post('/', async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;

  if (!phoneNumber) {
    res.set('Content-Type', 'text/plain');
    return res.send('END Error: Phone number not provided by mobile network.');
  }

  try {
    // 1. Authenticate user
    const variants = getPhoneVariants(phoneNumber);
    const placeholders = variants.map(() => '?').join(',');
    const users = await db.query(
      `SELECT * FROM users WHERE phone IN (${placeholders}) AND status = 'ACTIVE'`,
      variants
    );

    if (!users || users.length === 0) {
      res.set('Content-Type', 'text/plain');
      return res.send(`END Welcome to APM Bauchi Situation Room.\nYour phone number (${phoneNumber}) is not registered as an active field agent.\nPlease contact your coordinator.`);
    }

    const user = users[0];

    // Load Polling Unit Name and Code if assigned
    let puName = 'Assigned Polling Unit';
    if (user.polling_unit_id) {
      const pus = await db.query('SELECT name, code FROM polling_units WHERE id = ?', [user.polling_unit_id]);
      if (pus && pus.length > 0) {
        puName = `${pus[0].name} (${pus[0].code})`;
      }
    }

    // Split inputs by '*' (handling empty input)
    const parts = text && text.trim() !== '' ? text.split('*') : [];

    // Evaluate state
    const result = await evaluateSession(parts, user, puName);

    if (result.error) {
      res.set('Content-Type', 'text/plain');
      return res.send(`END ${result.error}`);
    }

    const { state, data } = result;

    let response = '';

    // Generate output menus
    switch (state) {
      case 'MAIN_MENU':
        response = `CON Welcome ${user.fullname} to APM Situation Room.
Select option:
1. Submit Election Results
2. Report Election Incident`;
        break;

      case 'RESULT_PU_CODE':
        response = `CON Enter Polling Unit Code:`;
        break;

      case 'RESULT_APM':
        response = `CON [${data.polling_unit_name || puName}]
Enter APM votes:`;
        break;

      case 'RESULT_APC':
        response = `CON Enter APC votes:`;
        break;

      case 'RESULT_PDP':
        response = `CON Enter PDP votes:`;
        break;

      case 'RESULT_PRP':
        response = `CON Enter PRP votes:`;
        break;

      case 'RESULT_ADC':
        response = `CON Enter ADC votes:`;
        break;

      case 'RESULT_INVALID':
        response = `CON Enter Invalid votes:`;
        break;

      case 'RESULT_CONFIRM':
        const total = (data.apm_votes || 0) + (data.apc_votes || 0) + (data.pdp_votes || 0) + (data.prp_votes || 0) + (data.adc_votes || 0) + (data.invalid_votes || 0);
        response = `CON Confirm results for ${data.polling_unit_name || puName}:
APM: ${data.apm_votes} | APC: ${data.apc_votes}
PDP: ${data.pdp_votes} | PRP: ${data.prp_votes}
ADC: ${data.adc_votes} | Invalid: ${data.invalid_votes}
Total: ${total}
1. Confirm & Submit
2. Cancel`;
        break;

      case 'RESULT_SUBMITTED':
        const resultsTotal = (data.apm_votes || 0) + (data.apc_votes || 0) + (data.pdp_votes || 0) + (data.prp_votes || 0) + (data.adc_votes || 0) + (data.invalid_votes || 0);
        
        // Save to Database
        const existingResult = await db.query('SELECT id FROM election_results WHERE polling_unit_id = ?', [data.polling_unit_id]);
        if (existingResult && existingResult.length > 0) {
          await db.query(
            `UPDATE election_results 
             SET apm_votes = ?, apc_votes = ?, pdp_votes = ?, prp_votes = ?, adc_votes = ?, invalid_votes = ?, total_votes = ?, submitted_by = ?
             WHERE polling_unit_id = ?`,
            [data.apm_votes, data.apc_votes, data.pdp_votes, data.prp_votes, data.adc_votes, data.invalid_votes, resultsTotal, user.id, data.polling_unit_id]
          );
        } else {
          await db.query(
            `INSERT INTO election_results (polling_unit_id, apm_votes, apc_votes, pdp_votes, prp_votes, adc_votes, invalid_votes, total_votes, submitted_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.polling_unit_id, data.apm_votes, data.apc_votes, data.pdp_votes, data.prp_votes, data.adc_votes, data.invalid_votes, resultsTotal, user.id]
          );
        }
        response = `END Election results submitted successfully for ${data.polling_unit_name || puName}. Thank you!`;
        break;

      case 'RESULT_CANCELLED':
        response = `END Election result submission cancelled.`;
        break;

      case 'INCIDENT_PU_CODE':
        response = `CON Enter Polling Unit Code (or 0 to skip):`;
        break;

      case 'INCIDENT_CATEGORY':
        response = `CON Select Incident Category:
1. Vote Buying
2. Violence
3. Equipment Failure
4. Delay
5. Opponent Activity
6. Other`;
        break;

      case 'INCIDENT_DESC':
        response = `CON Describe the incident (briefly):`;
        break;

      case 'INCIDENT_CONFIRM':
        response = `CON Confirm Incident Report:
Category: ${data.category}
Desc: ${data.description}
1. Confirm & Submit
2. Cancel`;
        break;

      case 'INCIDENT_SUBMITTED':
        // Determine LGA and Ward details
        let targetLga = user.lga_id || 1; // Fallback default
        let targetWard = user.ward_id || null;
        let targetPu = data.polling_unit_id || null;

        if (targetPu) {
          const puDetails = await db.query(
            'SELECT pu.ward_id, w.lga_id FROM polling_units pu JOIN wards w ON pu.ward_id = w.id WHERE pu.id = ?',
            [targetPu]
          );
          if (puDetails && puDetails.length > 0) {
            targetWard = puDetails[0].ward_id;
            targetLga = puDetails[0].lga_id;
          }
        }

        const incidentTitle = `USSD Report: ${data.category.replace(/_/g, ' ')}`;

        await db.query(
          `INSERT INTO incidents (title, description, category, lga_id, ward_id, polling_unit_id, reported_by, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [incidentTitle, data.description, data.category, targetLga, targetWard, targetPu, user.id]
        );

        if (data.category === 'VIOLENCE' || data.category === 'VOTE_BUYING') {
          sendSecurityAlert(data.category, data.polling_unit_name || puName, user.fullname, user.phone).catch(err => {
            console.error('Failed to dispatch security SMS alert:', err);
          });
        }

        response = `END Incident report logged successfully. Security teams notified. Thank you!`;
        break;

      case 'INCIDENT_CANCELLED':
        response = `END Incident reporting cancelled.`;
        break;

      default:
        response = `END Unexpected system state. Please dial again.`;
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);
  } catch (error) {
    console.error('USSD processing error:', error);
    res.set('Content-Type', 'text/plain');
    res.send('END Server error. Please try again later.');
  }
});

export default router;
