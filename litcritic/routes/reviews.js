const express = require('express');
const router = express.Router();
const Review = require('../models/Review');

// ==========================================
// 1. CREATE: Add a new review
// POST /api/reviews
// ==========================================
router.post('/', async (req, res) => {
  try {
    const newReview = new Review(req.body);
    const savedReview = await newReview.save();
    res.status(201).json(savedReview);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ==========================================
// 2. READ: Get reviews for a specific book (Filter, Sort, Limit)
// GET /api/reviews/books/:id/reviews?minRating=4
// ==========================================
router.get('/books/:id/reviews', async (req, res) => {
  try {
    const bookId = req.params.id;
    // Default minRating to 0 if not provided in the query string
    const minRating = req.query.minRating ? parseInt(req.query.minRating) : 0;

    const reviews = await Review.find({ 
      bookId: bookId,
      rating: { $gt: minRating } // Query Operator: Greater Than
    })
    .sort({ createdAt: -1 })     // Sort: Descending order (newest first)
    .limit(10);                  // Limit: Top 10 results

    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 3. READ: Search nested comments using $elemMatch and $regex
// GET /api/reviews/search-comments?user=John&keyword=helpful
// ==========================================
router.get('/search-comments', async (req, res) => {
  try {
    const targetUser = req.query.user;
    const keyword = req.query.keyword;

    const reviews = await Review.find({
      comments: {
        $elemMatch: { // Matches if at least one comment meets ALL criteria inside
          user: targetUser,
          text: { $regex: keyword, $options: 'i' } // Case-insensitive text search
        }
      }
    });

    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 4. UPDATE: Update a review (with Upsert)
// PUT /api/reviews/:id
// ==========================================
router.put('/:id', async (req, res) => {
  try {
    const updatedReview = await Review.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { 
        new: true,           // Returns the updated document
        runValidators: true, // Ensures the update follows schema rules (e.g., rating 1-5)
        upsert: true         // Creates the document if it doesn't exist
      }
    );
    res.json(updatedReview);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ==========================================
// 5. DELETE: Remove a review
// DELETE /api/reviews/:id
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const deletedReview = await Review.findByIdAndDelete(req.params.id);
    
    if (!deletedReview) {
      return res.status(404).json({ message: 'Review not found' });
    }
    
    res.json({ message: 'Review successfully deleted', deletedReview });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;