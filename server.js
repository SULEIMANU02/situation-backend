import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Import Routes
import authRoutes from './routes/auth.js';
import agentRoutes from './routes/agents.js';
import incidentRoutes from './routes/incidents.js';
import resultRoutes from './routes/results.js';
import campaignRoutes from './routes/campaign.js';
import ussdRoutes from './routes/ussd.js';
import voiceRoutes from './routes/voice.js';
import steeringRoutes from './routes/steering.js';
import directiveRoutes from './routes/directives.js';
import whatsappRoutes from './routes/whatsapp.js';

import { startWhatsApp } from './services/whatsapp.js';

dotenv.config();

// Global Uncaught Exception and Unhandled Rejection Safeguards
process.on('uncaughtException', (err) => {
  console.error('🛡️ [Process Guard] Uncaught Exception caught:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [Process Guard] Unhandled Rejection caught:', reason?.message || reason);
});

const app = express();
const PORT = process.env.PORT || 5000;

// Resolve dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes Middlewares
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/campaign', campaignRoutes);
app.use('/api/ussd', ussdRoutes);
app.use('/ussd', ussdRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/voice', voiceRoutes);
app.use('/api/steering-committee', steeringRoutes);
app.use('/api/lga-coordinators', steeringRoutes);
app.use('/api/directives', directiveRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Basic Health Endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    message: 'APM Bauchi Situation Room API Server is online.',
    candidate: 'Hon. Yakubu Adamu PhD',
    party: 'APM (Allied Peoples Movement)',
    state: 'Bauchi State',
    mockMode: process.env.MOCK_DB === 'true'
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack);
  res.status(500).json({
    message: err.message || 'An unexpected server error occurred.',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 APM Situation Room Server running on port ${PORT}`);
  console.log(`🎯 State: Bauchi | Candidate: Hon. Yakubu Adamu PhD`);
  console.log(`📁 Static files folder: ${path.join(__dirname, 'uploads')}`);
  console.log(`⚙️  Mock DB mode: ${process.env.MOCK_DB === 'true' ? 'ENABLED (InMemory)' : 'DISABLED (MySQL)'}`);
  console.log(`===================================================`);

  // Start WhatsApp bot service
  startWhatsApp().catch((err) => {
    console.error('❌ Failed to start WhatsApp bot:', err);
  });
});
