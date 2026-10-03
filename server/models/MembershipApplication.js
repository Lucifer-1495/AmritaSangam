const mongoose = require('mongoose');

const membershipApplicationSchema = new mongoose.Schema({
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    requestedPosition: { type: String, enum: ['member', 'executive'], default: 'member' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    rejectionFeedback: { type: String, trim: true, maxlength: 2000 },
    appliedDate: { type: Date, default: Date.now }
}, { timestamps: true });

membershipApplicationSchema.index(
    { clubId: 1, profileId: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('MembershipApplication', membershipApplicationSchema);