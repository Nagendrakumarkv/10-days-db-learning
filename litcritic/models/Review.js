const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  user: { type: String, required: true },
  text: { type: String, required: true },
  date: { type: Date, default: Date.now }
});

const reviewSchema = new mongoose.Schema({
  bookId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Book', // Assuming you have a Book model
    required: true 
  },
  reviewer: { type: String, required: true },
  rating: { 
    type: Number, 
    required: true,
    min: 1,
    max: 5
  },
  content: { type: String, required: true },
  // This is where we will practice $elemMatch
  comments: [commentSchema], 
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Review', reviewSchema);