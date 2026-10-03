const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    status: { type: String, enum: ['present', 'absent', 'excused'], default: 'present' },
    checkInTime: { type: Date, default: Date.now }
}, { timestamps: true });

attendanceSchema.index({ eventId: 1, profileId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);