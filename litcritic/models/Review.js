const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  user: { type: String, required: true },
  text: { type: String, required: true },
  date: { type: Date, default: Date.now }
});

const reviewSchema = new mongoose.Schema({
  // Added index: true
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
  reviewer: { type: String, required: true },
  // Added index: true
  rating: { type: Number, required: true, min: 1, max: 5, index: true },
  content: { type: String, required: true },
  comments: [commentSchema],
  // Added index: true
  createdAt: { type: Date, default: Date.now, index: true }
});

// Compound Index: Great for queries that filter by bookId AND sort by rating/date
reviewSchema.index({ bookId: 1, createdAt: -1 }); 

module.exports = mongoose.model('Review', reviewSchema);