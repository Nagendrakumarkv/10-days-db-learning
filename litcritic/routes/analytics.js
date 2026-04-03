const express = require('express');
const router = express.Router();
const Review = require('../models/Review');

// ==========================================
// 1. Average Rating & Review Count per Book
// GET /api/analytics/book-stats
// ==========================================
router.get('/book-stats', async (req, res) => {
  try {
    const stats = await Review.aggregate([
      // Stage 1: Group by bookId. Calculate average rating and total count.
      {
        $group: {
          _id: '$bookId', // What we are grouping by
          averageRating: { $avg: '$rating' }, // Calculates the mean
          totalReviews: { $sum: 1 } // Adds 1 for every document found
        }
      },
      // Stage 2: Sort by highest average rating
      { $sort: { averageRating: -1 } },
      
      // Stage 3 (Optional but powerful): $lookup acts like a SQL JOIN.
      // If you have a 'books' collection, this fetches the book details!
      {
        $lookup: {
          from: 'books', // The collection name in MongoDB (usually lowercase & plural)
          localField: '_id', // The grouped bookId
          foreignField: '_id', // The id in the books collection
          as: 'bookDetails' // The name of the new array field to output
        }
      }
    ]);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 2. Top Reviewers (Who writes the most reviews?)
// GET /api/analytics/top-reviewers
// ==========================================
router.get('/top-reviewers', async (req, res) => {
  try {
    const topReviewers = await Review.aggregate([
      // Stage 1: Group by reviewer name
      {
        $group: {
          _id: '$reviewer',
          reviewCount: { $sum: 1 }
        }
      },
      // Stage 2: Sort descending by count
      { $sort: { reviewCount: -1 } },
      // Stage 3: Only return the top 5
      { $limit: 5 }
    ]);
    res.json(topReviewers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================================
// 3. Most Commented Reviews (Using Array Size)
// GET /api/analytics/most-commented
// ==========================================
router.get('/most-commented', async (req, res) => {
  try {
    const highlyCommented = await Review.aggregate([
      // Stage 1: $addFields (or $project) allows us to create a computed field
      // Here, we calculate the length of the 'comments' array
      {
        $addFields: {
          commentCount: { $size: '$comments' }
        }
      },
      // Stage 2: We only want reviews that actually have comments
      { $match: { commentCount: { $gt: 0 } } },
      // Stage 3: Sort by highest comment count
      { $sort: { commentCount: -1 } },
      // Stage 4: Limit to top 5
      { $limit: 5 },
      // Stage 5: Clean up the output using $project (like SQL SELECT)
      {
        $project: {
          reviewer: 1,
          content: 1,
          commentCount: 1,
          rating: 1
        }
      }
    ]);
    res.json(highlyCommented);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;