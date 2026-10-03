const mongoose = require('mongoose');

const fundingRequestSchema = new mongoose.Schema({
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' }, // Optional
    requestedAmount: { type: Number, required: true, min: 0.01 },
    purpose: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    rejectionFeedback: { type: String, trim: true, maxlength: 2000 },
    requestDate: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('FundingRequest', fundingRequestSchema);