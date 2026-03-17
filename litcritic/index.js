require('dotenv').config();
const express = require('express');
const { Client } = require('pg');
const { MongoClient } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Database Clients
const pgClient = new Client({ connectionString: process.env.PG_URI });
const mongoClient = new MongoClient(process.env.MONGO_URI);

async function startServer() {
  try {
    // 1. Connect to PostgreSQL
    await pgClient.connect();
    console.log('✅ PostgreSQL connected successfully!');

    // 2. Connect to MongoDB
    await mongoClient.connect();
    console.log('✅ MongoDB connected successfully!');
    
    // We can explicitly create/select the database in Mongo
    const mongoDb = mongoClient.db('litcritic');

    // 3. Simple Ping Route
    app.get('/ping', (req, res) => {
      res.status(200).json({ 
        success: true, 
        message: "Postgres & MongoDB connected! 🚀" 
      });
    });

    // 4. Start Express Server
    app.listen(port, () => {
      console.log(`📚 LitCritic server running at http://localhost:${port}`);
    });

  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}

startServer();