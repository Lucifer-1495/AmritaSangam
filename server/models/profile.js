const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
    supabaseId: { type: String, required: true, unique: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: {
        type: String,
        enum: ['student', 'club_committee', 'faculty_coordinator', 'college_admin', 'icts'],
        default: 'student',
    },
    adminType: {
        type: String,
        enum: ['student_affairs', 'principal', 'other_authority'],
    },
    facultyId: { type: String, trim: true, maxlength: 40, default: '' },
    registerNumber: { type: String, trim: true, maxlength: 40, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    department: { type: String, trim: true, maxlength: 100, default: '' },
    joiningYear: { type: Number },
    designation: { type: String, trim: true, maxlength: 100, default: '' },
    bio: { type: String, trim: true, maxlength: 500, default: '' },
    avatarUrl: { type: String, default: '' },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});

module.exports = mongoose.model('Profile', profileSchema);