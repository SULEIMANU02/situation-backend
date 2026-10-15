# situation-backend

APM Situation Room — Node.js, Express, MySQL & Baileys WhatsApp Vanguard Bot API.

## Features
- **Express REST API**: Central command collation, LGAs, Wards, Polling Units, Incidents, Agents, and Directives.
- **WhatsApp Vanguard Bot**: Baileys-powered multi-lingual (Hausa/English) result collation, incident triage, and directive cascade.
- **AI Engine**: Groq Whisper & Llama for automated audio transcription and natural language result parsing.
- **USSD & Voice**: Africa's Talking integration for off-grid frontline polling unit reporting.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```

3. Start server:
   ```bash
   npm start
   ```
