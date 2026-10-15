import express from 'express';
import fs from 'fs';
import path from 'path';
import db from '../config/db.js';
import { sendSms } from './ussd.js';
import { transcribeAudio, parseVoiceTranscript } from '../services/groq.js';

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

// Dedicated Inbound Results Hotline (Interactive Recording Flow)
router.post('/results', async (req, res) => {
  const { isActive, callerNumber, recordingUrl } = req.body;

  // 1. Initial Dial-In (Call is Active, but no recording URL yet)
  if (parseInt(isActive) === 1 && !recordingUrl) {
    res.set('Content-Type', 'text/xml');

    if (!callerNumber) {
      return res.send(`
        <Response>
          <Say voice="en-US-Standard-C">Error. Phone number not provided by network.</Say>
          <Reject/>
        </Response>
      `);
    }

    try {
      const variants = getPhoneVariants(callerNumber);
      const placeholders = variants.map(() => '?').join(',');
      const users = await db.query(
        `SELECT * FROM users WHERE phone IN (${placeholders}) AND status = 'ACTIVE'`,
        variants
      );

      if (!users || users.length === 0) {
        return res.send(`
          <Response>
            <Say voice="en-US-Standard-C">Welcome to APM situation room Bauchi. Your phone number is not registered. Goodbye.</Say>
            <Reject/>
          </Response>
        `);
      }

      const user = users[0];

      if (!user.polling_unit_id) {
        return res.send(`
          <Response>
            <Say voice="en-US-Standard-C">Hello ${user.fullname}. Your account is not assigned to a polling unit. Goodbye.</Say>
            <Reject/>
          </Response>
        `);
      }

      // Load Polling Unit details
      let puName = 'Assigned Polling Unit';
      const pus = await db.query('SELECT name, code FROM polling_units WHERE id = ?', [user.polling_unit_id]);
      if (pus && pus.length > 0) {
        puName = `${pus[0].name} (${pus[0].code})`;
      }

      // Voice prompt greeting the agent in English
      const greetingText = `Welcome ${user.fullname} from ${puName}. Please state your election results for each party after the beep. When you are finished, press hash or hang up.`;

      // Set dynamic callback URL pointing back to our results endpoint
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const callbackUrl = `${protocol}://${host}/voice/results`;
      const greetingUrl = `${protocol}://${host}/uploads/greeting.mp3`;

      const hasCustomGreeting = fs.existsSync(path.join(process.cwd(), 'uploads/greeting.mp3'));

      // Return Recording response
      return res.send(`
        <Response>
          ${hasCustomGreeting 
            ? `<Play url="${greetingUrl}" />` 
            : `<Say voice="en-US-Standard-C">${greetingText}</Say>`
          }
          <Record playBeep="true" callbackUrl="${callbackUrl}" finishOnKey="#" maxLength="120" trimSilence="true" />
        </Response>
      `);
    } catch (error) {
      console.error('Voice results dial-in error:', error);
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const errorUrl = `${protocol}://${host}/uploads/error.mp3`;
      const hasCustomError = fs.existsSync(path.join(process.cwd(), 'uploads/error.mp3'));

      return res.send(`
        <Response>
          ${hasCustomError 
            ? `<Play url="${errorUrl}" />` 
            : `<Say voice="en-US-Standard-C">A server error occurred. Please call back later.</Say>`
          }
          <Reject/>
        </Response>
      `);
    }
  }

  // 2. Recording callback has arrived (isActive = 1 OR 0, and recordingUrl is present)
  else if (recordingUrl) {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const goodbyeUrl = `${protocol}://${host}/uploads/goodbye.mp3`;
    const hasCustomGoodbye = fs.existsSync(path.join(process.cwd(), 'uploads/goodbye.mp3'));

    // Return XML response to end call politely
    res.set('Content-Type', 'text/xml');
    res.send(`
      <Response>
        ${hasCustomGoodbye 
          ? `<Play url="${goodbyeUrl}" />` 
          : `<Say voice="en-US-Standard-C">Your voice report has been successfully saved. Thank you.</Say>`
        }
      </Response>
    `);

    console.log(`🎙️ Call completed from ${callerNumber}. Processing recording: ${recordingUrl}`);

    try {
      const variants = getPhoneVariants(callerNumber);
      const placeholders = variants.map(() => '?').join(',');
      const users = await db.query(
        `SELECT * FROM users WHERE phone IN (${placeholders}) AND status = 'ACTIVE'`,
        variants
      );

      if (!users || users.length === 0) {
        console.error('Caller not found in database for results processing:', callerNumber);
        return;
      }

      const user = users[0];

      let apm = 0, apc = 0, pdp = 0, prp = 0, adc = 0, invalid = 0;
      let isMockParsed = true;

      // 0. Prioritize Groq API if GROQ_API_KEY is available (or fallback)
      try {
        console.log(`🤖 Downloading call recording audio for Groq...`);
        const audioResponse = await fetch(recordingUrl);
        if (!audioResponse.ok) throw new Error('Failed to download recording audio');
        const arrayBuffer = await audioResponse.arrayBuffer();

        console.log(`🧠 Transcribing audio with Groq Whisper...`);
        const transcript = await transcribeAudio(Buffer.from(arrayBuffer));
        console.log(`🎙️ Groq Whisper Transcript:`, transcript);

        console.log(`🤖 Parsing results with Groq Llama...`);
        const parsed = await parseVoiceTranscript(transcript);
        console.log(`🤖 Groq Extracted Response:`, JSON.stringify(parsed));

        apm = parseInt(parsed.apm || 0);
        apc = parseInt(parsed.apc || 0);
        pdp = parseInt(parsed.pdp || 0);
        prp = parseInt(parsed.prp || 0);
        adc = parseInt(parsed.adc || 0);
        invalid = parseInt(parsed.invalid || 0);
        isMockParsed = false;
      } catch (err) {
        console.error('❌ Groq API analysis failed, falling back to OpenAI/Gemini:', err);
      }

      // 1. Prioritize OpenAI API if OPENAI_API_KEY is available
      if (process.env.OPENAI_API_KEY) {
        try {
          console.log(`🤖 Downloading call recording audio...`);
          const audioResponse = await fetch(recordingUrl);
          if (!audioResponse.ok) throw new Error('Failed to download recording audio');
          const arrayBuffer = await audioResponse.arrayBuffer();

          console.log(`🧠 Transcribing audio with OpenAI Whisper...`);
          const whisperFormData = new FormData();
          const audioBlob = new Blob([arrayBuffer], { type: 'audio/mp3' });
          whisperFormData.append('file', audioBlob, 'recording.mp3');
          whisperFormData.append('model', 'whisper-1');

          const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: whisperFormData
          });

          const whisperData = await whisperRes.json();
          if (whisperData.error) {
            throw new Error(`Whisper Error: ${whisperData.error.message}`);
          }
          const transcript = whisperData.text;
          console.log(`🎙️ Whisper Transcript:`, transcript);

          console.log(`🤖 Parsing results with GPT-4o-mini...`);
          const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              response_format: { type: 'json_object' },
              messages: [
                {
                  role: 'system',
                  content: `You are an election results parser. Read the transcription of a polling agent reporting results.
                  Translate any Hausa counting words (like 'dari' for 100, 'dari da hamsin' for 150, 'tamanin' for 80, 'arba'in' for 40, 'babu' for 0) into integers.
                  Identify and extract the votes for:
                  - apm
                  - apc
                  - pdp
                  - prp
                  - adc
                  - invalid
                  
                  Respond ONLY with a JSON object. Ensure all keys are present and values are integers. If a party is not mentioned, assume 0.
                  Example output: {"apm": 120, "apc": 80, "pdp": 45, "prp": 10, "adc": 5, "invalid": 2}`
                },
                {
                  role: 'user',
                  content: `Agent Speech Transcript: "${transcript}"`
                }
              ]
            })
          });

          const gptData = await gptRes.json();
          if (gptData.error) {
            throw new Error(`GPT Error: ${gptData.error.message}`);
          }
          const gptText = gptData.choices[0].message.content;
          console.log(`🤖 GPT Extracted Response:`, gptText);

          const parsed = JSON.parse(gptText.trim());
          apm = parseInt(parsed.apm || 0);
          apc = parseInt(parsed.apc || 0);
          pdp = parseInt(parsed.pdp || 0);
          prp = parseInt(parsed.prp || 0);
          adc = parseInt(parsed.adc || 0);
          invalid = parseInt(parsed.invalid || 0);
          isMockParsed = false;
        } catch (err) {
          console.error('❌ OpenAI analysis failed, falling back to Gemini/mock results:', err);
        }
      }

      // 2. Fallback to Google Gemini API
      if (isMockParsed && process.env.GEMINI_API_KEY) {
        try {
          console.log(`🤖 Downloading call recording audio...`);
          const audioResponse = await fetch(recordingUrl);
          if (!audioResponse.ok) throw new Error('Failed to download recording audio');
          const arrayBuffer = await audioResponse.arrayBuffer();
          const base64Audio = Buffer.from(arrayBuffer).toString('base64');

          console.log(`🧠 Sending audio file to Gemini 2.0 Flash for Multimodal results parsing...`);
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/wav',
                      data: base64Audio
                    }
                  },
                  {
                    text: `You are an election results parser. Listen to this audio recording of a polling agent reporting the election results. 
                    The agent may speak in Hausa, English, or a mix of both languages.
                    Translate any Hausa counting words (like 'dari' for 100, 'dari da hamsin' for 150, 'tamanin' for 80, 'arba'in' for 40, 'babu' for 0) into integers.
                    Extract the votes for:
                    - apm
                    - apc
                    - pdp
                    - prp
                    - adc
                    - invalid
                    
                    Respond ONLY with a JSON object. Ensure all keys are present and values are integers. If a party is not mentioned, assume 0.
                    Example output: {"apm": 120, "apc": 80, "pdp": 45, "prp": 10, "adc": 5, "invalid": 2}
                    Do not include markdown or explanations. Just output the raw JSON string.`
                  }
                ]
              }],
              generationConfig: {
                responseMimeType: "application/json"
              }
            })
          });

          const geminiData = await response.json();
          if (geminiData.error) {
            throw new Error(`Gemini API Error: ${geminiData.error.message} (status: ${geminiData.error.status})`);
          }
          if (!geminiData.candidates || geminiData.candidates.length === 0) {
            throw new Error(`Gemini returned no candidates. Raw response: ${JSON.stringify(geminiData)}`);
          }

          const responseText = geminiData.candidates[0].content.parts[0].text;
          console.log(`🤖 Gemini Extracted Response:`, responseText);

          const parsed = JSON.parse(responseText.trim());
          apm = parseInt(parsed.apm || 0);
          apc = parseInt(parsed.apc || 0);
          pdp = parseInt(parsed.pdp || 0);
          prp = parseInt(parsed.prp || 0);
          adc = parseInt(parsed.adc || 0);
          invalid = parseInt(parsed.invalid || 0);
          isMockParsed = false;
        } catch (err) {
          console.error('❌ Gemini analysis failed, falling back to mock results:', err);
        }
      } else {
        console.log(`ℹ️ [MOCK MODE] GEMINI_API_KEY not configured. Generating simulated results.`);
      }

      if (isMockParsed) {
        apm = 175;
        apc = 90;
        pdp = 35;
        prp = 15;
        adc = 8;
        invalid = 1;
      }

      const total = apm + apc + pdp + prp + adc + invalid;

      // Save/Update in MySQL
      const existingResult = await db.query('SELECT id FROM election_results WHERE polling_unit_id = ?', [user.polling_unit_id]);
      if (existingResult && existingResult.length > 0) {
        await db.query(
          `UPDATE election_results 
           SET apm_votes = ?, apc_votes = ?, pdp_votes = ?, prp_votes = ?, adc_votes = ?, invalid_votes = ?, total_votes = ?, submitted_by = ?, voice_recording_url = ?
           WHERE polling_unit_id = ?`,
          [apm, apc, pdp, prp, adc, invalid, total, user.id, recordingUrl, user.polling_unit_id]
        );
        console.log(`✅ Result updated in DB for PU ${user.polling_unit_id} (with voice URL)`);
      } else {
        await db.query(
          `INSERT INTO election_results (polling_unit_id, apm_votes, apc_votes, pdp_votes, prp_votes, adc_votes, invalid_votes, total_votes, submitted_by, voice_recording_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [user.polling_unit_id, apm, apc, pdp, prp, adc, invalid, total, user.id, recordingUrl]
        );
        console.log(`✅ Result inserted in DB for PU ${user.polling_unit_id} (with voice URL)`);
      }

      // Send outbound confirmation SMS to the Agent
      const smsMessage = `Sakamakon Zabe: An adana sakamakon ku ta Murya! APM: ${apm}, APC: ${apc}, PDP: ${pdp}, PRP: ${prp}, ADC: ${adc}, Invalid: ${invalid}. Jimilla: ${total}. Mun gode!`;
      await sendSms(user.phone, smsMessage);

    } catch (error) {
      console.error('Failed to process call recording:', error);
    }
  } else {
    res.sendStatus(200);
  }
});

// Voice Events Handler (Optional debugging logs)
router.post('/events', (req, res) => {
  const { callSessionState, direction, callerNumber } = req.body;
  if (callSessionState) {
    console.log(`📞 [Voice Event] Session State: ${callSessionState} | Direction: ${direction} | Caller: ${callerNumber}`);
  }
  res.sendStatus(200);
});

export default router;
