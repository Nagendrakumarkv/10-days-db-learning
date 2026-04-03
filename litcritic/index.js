require("dotenv").config();
const express = require("express");
const { Client } = require("pg");
const mongoose = require("mongoose"); // <-- Added Mongoose
const reviewsRouter = require("./routes/reviews");
const analyticsRouter = require("./routes/analytics");
const Review = require("./models/Review");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan"); // HTTP request logger

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// New Analytics routes
app.use("/api/analytics", analyticsRouter);

// 1. CREATE pgClient FIRST
const pgClient = new Client({ connectionString: process.env.PG_URI });

// 2. THEN PASS IT TO THE ROUTER
app.use("/api/reviews", reviewsRouter(pgClient));

// 1. Basic Logging (Logs every request and status code to the terminal)
app.use(morgan("dev"));

// 2. Rate Limiting (Prevents DDoS and brute force attacks)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  message: { error: "Too many requests from this IP, please try again later." },
});
app.use(limiter); // Apply to all routes

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_for_dev";

const port = process.env.PORT || 3000;

// B. Middleware to Protect Routes
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Format: "Bearer <token>"

  if (!token)
    return res.status(401).json({ error: "Access denied. No token provided." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err)
      return res.status(403).json({ error: "Invalid or expired token." });
    req.user = user; // Attach user info to request
    next(); // Move to the next function
  });
}

async function startServer() {
  try {
    // 1. Connect to PostgreSQL
    await pgClient.connect();
    console.log("✅ PostgreSQL connected successfully!");

    // 2. Connect to MongoDB using Mongoose instead of MongoClient
    // Mongoose handles the connection globally for all your models
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB (Mongoose) connected successfully!");

    // Hello World Route
    app.get("/hello-world", (req, res) => {
      res.status(200).send("Hi All");
    });

    // 3. Simple Ping Route
    app.get("/ping", (req, res) => {
      res.status(200).json({
        success: true,
        message: "Postgres & MongoDB connected! 🚀",
      });
    });

    // A. Login Route (Creates the Token)
    app.post("/login", async (req, res) => {
      const { username, password } = req.body;
      try {
        const result = await pgClient.query(
          "SELECT * FROM users WHERE username = $1",
          [username],
        );
        const user = result.rows[0];

        if (user && user.password === password) {
          // Create token valid for 1 hour
          const token = jwt.sign(
            { userId: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: "1h" },
          );
          res.json({ token });
        } else {
          res.status(401).json({ error: "Invalid credentials" });
        }
      } catch (err) {
        res.status(500).json({ error: "Login failed" });
      }
    });

    // GET /books - Fetch all books with authors and genres
    app.get("/books", authenticateToken, async (req, res) => {
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

    // GET /books/:id - Fetch book (PG) + Reviews (Mongo)
    app.get("/books/:id", async (req, res) => {
      try {
        const bookId = req.params.id;

        // 1. Fetch structured data from PostgreSQL
        const pgQuery = `
      SELECT b.id, b.title, b.published_year, b.summary, a.name AS author
      FROM books b
      INNER JOIN authors a ON b.author_id = a.id
      WHERE b.id = $1;
    `;
        const pgResult = await pgClient.query(pgQuery, [bookId]);

        if (pgResult.rows.length === 0) {
          return res.status(404).json({ error: "Book not found" });
        }

        const bookDetails = pgResult.rows[0];

        // 2. Fetch unstructured data from MongoDB
        // Note: In Mongo, bookId was stored as an ObjectId. We might need to adjust this
        // depending on how you saved them in Day 7. For this example, assuming bookId in Mongo
        // was saved as a string to match the Postgres ID.
        const reviews = await Review.find({ bookId: bookId })
          .sort({ createdAt: -1 })
          .select("-__v"); // Exclude the mongoose version key for cleaner output

        // 3. Combine and send the polyglot response!
        const fullResponse = {
          ...bookDetails,
          reviews: reviews,
        };

        res.status(200).json(fullResponse);
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .json({ error: "Failed to fetch complete book profile" });
      }
    });

    // POST /books - Create a new book with genres (Using a Transaction)
    app.post("/books", async (req, res) => {
      const { title, author_id, published_year, genre_ids } = req.body;

      try {
        // 1. Start Transaction
        await pgClient.query("BEGIN");

        // 2. Insert into Books table and return the new ID
        const insertBookQuery = `
          INSERT INTO books (title, author_id, published_year) 
          VALUES ($1, $2, $3) RETURNING id;
        `;
        const bookResult = await pgClient.query(insertBookQuery, [
          title,
          author_id,
          published_year,
        ]);
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
        await pgClient.query("COMMIT");

        res
          .status(201)
          .json({ success: true, message: "Book created!", bookId: newBookId });
      } catch (err) {
        // 5. Rollback Transaction on error (Undo everything)
        await pgClient.query("ROLLBACK");
        console.error(err);
        res
          .status(500)
          .json({ error: "Transaction failed. No data was saved." });
      }
    });

    // ---------------------------------------------------------
    // DAY 4: ADVANCED QUERIES & OPTIMIZATION
    // ---------------------------------------------------------

    // 1. GET /search - Search across title, author, and genre
    app.get("/search", async (req, res) => {
      try {
        const { q } = req.query; // Extracts ?q=something from the URL
        if (!q)
          return res.status(400).json({ error: "Missing search query 'q'" });

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
    app.get("/analytics/top-books", async (req, res) => {
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
    app.get("/analytics/ratings", async (req, res) => {
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

    // ---------------------------------------------------------
    // DAY 5: TRANSACTIONS, TRIGGERS & FUNCTIONS
    // ---------------------------------------------------------

    // 1. POST /orders - Buy a book (ACID Transaction)
    app.post("/orders", async (req, res) => {
      const { book_id, user_id } = req.body;

      try {
        await pgClient.query("BEGIN"); // Start Transaction

        // Step A: Check stock and LOCK THE ROW so no other transaction can modify it
        const checkStockQuery =
          "SELECT stock FROM books WHERE id = $1 FOR UPDATE";
        const stockResult = await pgClient.query(checkStockQuery, [book_id]);

        if (stockResult.rows.length === 0) {
          await pgClient.query("ROLLBACK");
          return res.status(404).json({ error: "Book not found" });
        }

        const currentStock = stockResult.rows[0].stock;

        // Step B: Application-level consistency check
        if (currentStock <= 0) {
          await pgClient.query("ROLLBACK");
          return res
            .status(400)
            .json({ error: "Sorry, this book is out of stock!" });
        }

        // Step C: Reduce stock (Our PostgreSQL Trigger will auto-update 'last_updated' here!)
        const updateStockQuery =
          "UPDATE books SET stock = stock - 1 WHERE id = $1";
        await pgClient.query(updateStockQuery, [book_id]);

        // Step D: Record the order
        const insertOrderQuery =
          "INSERT INTO orders (book_id, user_id) VALUES ($1, $2) RETURNING id";
        const orderResult = await pgClient.query(insertOrderQuery, [
          book_id,
          user_id,
        ]);

        await pgClient.query("COMMIT"); // Commit Transaction (Save permanently)

        res.status(201).json({
          success: true,
          message: "Order placed successfully!",
          orderId: orderResult.rows[0].id,
        });
      } catch (err) {
        await pgClient.query("ROLLBACK"); // Undo everything on error
        console.error(err);
        res.status(500).json({ error: "Transaction failed. Order cancelled." });
      }
    });

    // 2. GET /books/:id/popularity - Execute our Stored Function
    app.get("/books/:id/popularity", async (req, res) => {
      try {
        // We call the function directly in the SELECT statement
        const query = "SELECT get_book_popularity($1) AS score";
        const result = await pgClient.query(query, [req.params.id]);

        res.status(200).json({
          book_id: req.params.id,
          popularity_score: result.rows[0].score,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to calculate popularity" });
      }
    });

    // A quick test route to fetch the review you just created in mongosh
    app.get("/api/reviews", async (req, res) => {
      try {
        // Fetch all reviews
        const reviews = await mongoDb.collection("reviews").find({}).toArray();
        res.json(reviews);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch reviews" });
      }
    });
    // 4. Start Express Server
    app.listen(port, () => {
      console.log(`📚 LitCritic server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    process.exit(1);
  }
}

startServer();
