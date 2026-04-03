# 📊 PostgreSQL vs. MongoDB: 2026 Architectural Notes

Building "LitCritic" required utilizing both relational and non-relational paradigms. Here is a breakdown of when and why to use each.

## 🐘 When PostgreSQL Wins (Relational / SQL)

PostgreSQL is the gold standard for **structured data and strict relationships**.

- **ACID Transactions:** When money, inventory, or critical states are involved. (e.g., Decrementing book stock while generating an order receipt). If one step fails, the whole transaction rolls back.
- **Complex Joins:** When data is highly normalized (Books -> Authors -> Genres). SQL makes it trivial to weave these tables together via foreign keys.
- **Data Integrity:** Strict schemas and constraints (e.g., `NOT NULL`, `UNIQUE`) ensure bad data never enters the system.

_LitCritic Use Case:_ Users, Orders, Inventory, and Book Metadata.

## 🍃 When MongoDB Wins (Document / NoSQL)

MongoDB excels at **flexible, nested, and read-heavy unstructured data**.

- **Flexible Schema:** If a review suddenly needs to support "image URLs" or "upvotes", you don't need to run a time-consuming database migration (like `ALTER TABLE`). You just save the new JSON structure.
- **Nested Data:** We embedded `comments` directly inside the `reviews` document. Fetching a review + its comments is a single, lightning-fast read operation, avoiding complex SQL Joins.
- **Horizontal Scalability:** MongoDB is built to natively "shard" (split) massive amounts of data across multiple cheap servers seamlessly.

_LitCritic Use Case:_ Reviews, Nested Comments, and User Activity Logs.

## 🤝 Polyglot Persistence (The Best of Both Worlds)

Why choose one? In modern microservices, we use both.
In our `GET /books/:id` route, we used Postgres to fetch the strict, transactional book data, and MongoDB to quickly fetch the massive, unstructured array of reviews. We merged them at the application level to serve a unified JSON response to the frontend.
