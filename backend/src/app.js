import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { db } from './db/db.js';

import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import searchRoutes from './routes/search.js';
import askRoutes from './routes/ask.js';

const app = express();

// Middleware
app.use(cors({
  origin: '*', // Allow frontend development server
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Raw body parser specifically for PUT local uploads (supports binary streams)
app.use('/api/documents/local-upload', express.raw({ type: '*/*', limit: '50mb' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging in development
if (config.nodeEnv === 'development') {
  app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'CloudVault API',
    version: '1.0.0',
    dbEngine: config.db.host ? 'PostgreSQL (RDS / pgvector)' : 'Local Embedded Storage',
    storageMode: (config.aws.accessKeyId && config.aws.bucketName) ? 'AWS S3' : 'Local Storage',
    aiEngine: config.ai.engine
  });
});

// Route registration
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/ask', askRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.url}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[App] Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Server bootstrap
async function startServer() {
  try {
    // Initialize active database engine
    await db.init();

    app.listen(config.port, () => {
      console.log('====================================================');
      console.log(`🚀 CloudVault API Server running on port ${config.port}`);
      console.log(`📡 Health Check: http://localhost:${config.port}/api/health`);
      console.log(`🗄️  Database: ${config.db.host ? `PostgreSQL @ ${config.db.host}` : 'Local Embedded Engine'}`);
      console.log(`📦 Storage: ${config.aws.bucketName ? `AWS S3 (${config.aws.bucketName})` : 'Local Filesystem'}`);
      console.log('====================================================');
    });
  } catch (err) {
    console.error('Failed to start CloudVault backend server:', err);
    process.exit(1);
  }
}

startServer();

export default app;
