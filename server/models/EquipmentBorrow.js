const mongoose = require('mongoose');

const equipmentBorrowSchema = new mongoose.Schema({
    equipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
    borrowDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    returnDate: { type: Date },
    status: {
        type: String,
        enum: ['mentor_pending', 'student_affairs_pending', 'approved', 'rejected', 'borrowed', 'returned', 'overdue'],
        default: 'mentor_pending',
    },
    mentorReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    studentAffairsReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    rejectionStage: { type: String, enum: ['mentor', 'student_affairs'] },
    rejectionFeedback: { type: String, trim: true, maxlength: 2000 },
}, { timestamps: true });

module.exports = mongoose.model('EquipmentBorrow', equipmentBorrowSchema);