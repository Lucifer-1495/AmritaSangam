const mongoose = require('mongoose');

const eventReportSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, unique: true },
  clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
  summary: { type: String, required: true, trim: true, maxlength: 5000 },
  activities: { type: String, required: true, trim: true, maxlength: 5000 },
  outcomes: { type: String, required: true, trim: true, maxlength: 5000 },
  issues: { type: String, trim: true, maxlength: 3000, default: '' },
  budgetSpent: { type: Number, min: 0, default: 0 },
  attendeeCount: { type: Number, min: 0, required: true },
  attendeeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }],
  rosterFileName: { type: String, required: true, trim: true },
  rosterCsv: { type: String, required: true },
  status: { type: String, enum: ['mentor_pending', 'student_affairs_pending', 'approved', 'rejected'], default: 'mentor_pending' },
  mentorReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
  studentAffairsReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
  rejectionStage: { type: String, enum: ['mentor', 'student_affairs'] },
  rejectionFeedback: { type: String, trim: true, maxlength: 2000 },
}, { timestamps: true });

module.exports = mongoose.model('EventReport', eventReportSchema);
