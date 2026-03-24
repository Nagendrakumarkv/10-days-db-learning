require('dotenv').config();
const express = require('express');
const { Client } = require('pg');
const { MongoClient } = require('mongodb');

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

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

    // GET /books - Fetch all books with authors and genres
    app.get('/books', async (req, res) => {
      try {
        const query = `
          SELECT 
            b.id, 
            b.title, 
            b.published_year, 
            a.name AS author,
            COALESCE(json_agg(g.name) FILTER (WHERE g.name IS NOT NULL), '[]') AS genres
          FROM books b
          INNER JOIN authors a ON b.author_id = a.id
          LEFT JOIN book_genres bg ON b.id = bg.book_id
          LEFT JOIN genres g ON bg.genre_id = g.id
          GROUP BY b.id, a.name
          ORDER BY b.id ASC;
        `;
        const result = await pgClient.query(query);
        res.status(200).json(result.rows);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch books" });
      }
    });

    // GET /books/:id - Fetch a single book
    app.get('/books/:id', async (req, res) => {
      try {
        const bookId = req.params.id;
        const query = `
          SELECT b.id, b.title, b.published_year, b.summary, a.name AS author
          FROM books b
          INNER JOIN authors a ON b.author_id = a.id
          WHERE b.id = $1;
        `;
        const result = await pgClient.query(query, [bookId]); // $1 is replaced by bookId

        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Book not found" });
        }
        res.status(200).json(result.rows[0]);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch book" });
      }
    });

    // POST /books - Create a new book with genres (Using a Transaction)
    app.post('/books', async (req, res) => {
      const { title, author_id, published_year, genre_ids } = req.body;

      try {
        // 1. Start Transaction
        await pgClient.query('BEGIN');

        // 2. Insert into Books table and return the new ID
        const insertBookQuery = `
          INSERT INTO books (title, author_id, published_year) 
          VALUES ($1, $2, $3) RETURNING id;
        `;
        const bookResult = await pgClient.query(insertBookQuery, [title, author_id, published_year]);
        const newBookId = bookResult.rows[0].id;

        // 3. Insert into Book_Genres join table (if genres were provided)
        if (genre_ids && genre_ids.length > 0) {
          const insertGenreQuery = `
            INSERT INTO book_genres (book_id, genre_id) VALUES ($1, $2);
          `;
          for (const genreId of genre_ids) {
            await pgClient.query(insertGenreQuery, [newBookId, genreId]);
          }
        }

        // 4. Commit Transaction (Save permanently)
        await pgClient.query('COMMIT');

        res.status(201).json({ success: true, message: "Book created!", bookId: newBookId });
      } catch (err) {
        // 5. Rollback Transaction on error (Undo everything)
        await pgClient.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Transaction failed. No data was saved." });
      }
    });

    // ---------------------------------------------------------
    // DAY 4: ADVANCED QUERIES & OPTIMIZATION
    // ---------------------------------------------------------

    // 1. GET /search - Search across title, author, and genre
    app.get('/search', async (req, res) => {
      try {
        const { q } = req.query; // Extracts ?q=something from the URL
        if (!q) return res.status(400).json({ error: "Missing search query 'q'" });

        // We use % for wildcard matching (e.g., %dune% matches "Children of Dune")
        const searchQuery = `%${q}%`;
        
        // ILIKE is Postgres-specific for Case-Insensitive matching
        const query = `
          SELECT DISTINCT b.id, b.title, a.name AS author, g.name AS genre
          FROM books b
          INNER JOIN authors a ON b.author_id = a.id
          LEFT JOIN book_genres bg ON b.id = bg.book_id
          LEFT JOIN genres g ON bg.genre_id = g.id
          WHERE b.title ILIKE $1 
             OR a.name ILIKE $1 
             OR g.name ILIKE $1;
        `;
        const result = await pgClient.query(query, [searchQuery]);
        res.status(200).json(result.rows);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Search failed" });
      }
    });

    // 2. GET /analytics/top-books - Fast sorting using our new column
    app.get('/analytics/top-books', async (req, res) => {
      try {
        const query = `
          SELECT id, title, views_count 
          FROM books 
          ORDER BY views_count DESC 
          LIMIT 10;
        `;
        const result = await pgClient.query(query);
        res.status(200).json(result.rows);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch top books" });
      }
    });

    // 3. GET /analytics/ratings - Fetching from the Materialized View!
    app.get('/analytics/ratings', async (req, res) => {
      try {
        // Notice we are querying the VIEW, not the base tables. It's lightning fast.
        const query = `SELECT * FROM mv_book_ratings ORDER BY avg_rating DESC NULLS LAST;`;
        const result = await pgClient.query(query);
        res.status(200).json(result.rows);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch ratings" });
      }
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