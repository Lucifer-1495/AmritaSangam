const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    title: { 
        type: String,
        required: true,
        trim: true,
        maxlength: 150,
    },
    description: { 
        type: String,
        trim: true,
        maxlength: 3000,
    },
    eventDate: { 
        type: Date, 
        required: true 
    },
    clubId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Club', 
        required: true 
    },
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue' },
    capacity: { type: Number, required: true, min: 1, default: 100 },
    registeredCount: { type: Number, required: true, min: 0, default: 0 },
    status: {
        type: String,
        enum: ['draft', 'mentor_pending', 'student_affairs_pending', 'approved', 'rejected'],
        default: 'mentor_pending',
    },
    eventType: { type: String, enum: ['technical', 'non_technical'], required: true, default: 'non_technical' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    mentorReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    studentAffairsReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    rejectionStage: { type: String, enum: ['mentor', 'student_affairs'] },
    rejectionFeedback: { type: String, trim: true, maxlength: 2000 },
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);