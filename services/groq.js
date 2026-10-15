import dotenv from 'dotenv';

dotenv.config();

const GROQ_API_URL = 'https://api.groq.com/openai/v1';

/**
 * Helper to call Groq chat completion API.
 */
async function callGroqChat(messages, jsonMode = false) {
  const apiKey = process.env.GROQ_API_KEY || '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';
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured in .env file.');
  }

  const payload = {
    model: 'qwen/qwen3.8-27b',
    messages,
    temperature: 0.1
  };

  if (jsonMode) {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API Chat Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Transcribes audio using Groq's Whisper API.
 * @param {Buffer} fileBuffer - Audio file buffer.
 * @returns {Promise<string>} The transcribed text.
 */
export async function transcribeAudio(fileBuffer, filename = 'recording.ogg', mimetype = 'audio/ogg') {
  const apiKey = process.env.GROQ_API_KEY || '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';
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured.');
  }

  const formData = new FormData();
  const fileBlob = new Blob([fileBuffer], { type: mimetype });
  formData.append('file', fileBlob, filename);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'ha');
  formData.append('prompt', 'Hausa election report from Bauchi, Nigeria. Common words: wani (someone), ya zo (came), ya dauki (took), akwatin zabe (ballot box), wurin zabe (polling unit), kuri\'a (vote), siyan kuri\'a (vote buying), fada (fighting), na\'ura (machine/device), lalace (broken/damaged), jami\'an tsaro (security agents). Party names: APM, APC, PDP, PRP, ADC. Numbers: dari (100), hamsin (50), ashirin (20), talatin (30), arba\'in (40), tamanin (80), babu (zero/none).');

  const response = await fetch(`${GROQ_API_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API Audio Transcription Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.text;
}

/**
 * Parses election results from a voice call transcript.
 * @param {string} transcript - The transcribed text of the call.
 * @returns {Promise<Object>} The parsed vote counts.
 */
export async function parseVoiceTranscript(transcript) {
  const messages = [
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
Example output: {"apm": 120, "apc": 80, "pdp": 45, "prp": 10, "adc": 5, "invalid": 2}
Ensure no markdown formatting or explanations. Output must be raw JSON.`
    },
    {
      role: 'user',
      content: `Agent Speech Transcript: "${transcript}"`
    }
  ];

  const text = await callGroqChat(messages, true);
  return JSON.parse(text.trim());
}

/**
 * Classifies and parses a WhatsApp message from a field agent.
 * @param {string} text - Message text from WhatsApp.
 * @returns {Promise<Object>} Object representing classification type and parsed data.
 */
export async function parseWhatsAppMessage(text) {
  const messages = [
    {
      role: 'system',
      content: `You are an election report parser for the APM campaign in Bauchi, Nigeria.
The agent may write or speak in HAUSA or ENGLISH or a mix of both. You MUST understand both languages.

Analyze the incoming message and classify it into one of three types:
1. "result": If the user is submitting election results (mentions parties and vote counts).
   Examples (English): "APM 120, APC 80, PDP 30"
   Examples (Hausa): "APM dari da ashirin, APC tamanin, PDP talatin" (APM 120, APC 80, PDP 30)
   Examples (Mixed): "APM ta samu dari, APC hamsin, PDP ashirin"
2. "incident": If the user is reporting an incident or problem (violence, delays, equipment issues, etc.).
   Examples (English): "thugs are fighting", "card reader broken"
   Examples (Hausa): "an fara fada a wurin zabe", "na'ura ta lalace", "ana siyan kuri'a"
3. "unrecognized": If the message is a greeting, general check-in, or unclear.

HAUSA NUMBER TRANSLATION GUIDE:
daya=1, biyu=2, uku=3, hudu=4, biyar=5, shida=6, bakwai=7, takwas=8, tara=9, goma=10, goma sha daya=11, goma sha biyu=12, ashirin=20, talatin=30, arba'in=40, hamsin=50, sittin=60, saba'in=70, tamanin=80, casa'in=90, dari=100, dari da hamsin=150, dubu=1000, babu=0.
"dari biyu" = 200, "dari da ashirin" = 120, "dari biyu da hamsin" = 250.

If it is a "result", extract votes for: apm, apc, pdp, prp, adc, invalid. If a party is not mentioned, use 0.
If it is an "incident", extract:
- category: one of: 'VOTE_BUYING', 'VIOLENCE', 'EQUIPMENT_FAILURE', 'DELAY', 'OPPONENT_ACTIVITY', 'OTHER'.
- description: a concise ENGLISH description summarizing the incident (translate Hausa to English).

Respond ONLY with a JSON object in this exact format:
{
  "type": "result" | "incident" | "unrecognized",
  "data": {
    "apm": integer,
    "apc": integer,
    "pdp": integer,
    "prp": integer,
    "adc": integer,
    "invalid": integer
  },
  "incident": {
    "category": "string",
    "description": "string"
  }
}
Only include "data" for results or "incident" for incidents. No markdown. Raw JSON only.`
    },
    {
      role: 'user',
      content: `Agent WhatsApp Message: "${text}"`
    }
  ];

  const responseText = await callGroqChat(messages, true);
  return JSON.parse(responseText.trim());
}
