const mongoose = require('mongoose');

const clubSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    category: { type: String, trim: true, default: 'Community' },
    clubType: { type: String, enum: ['technical', 'non_technical'], required: true, default: 'non_technical' },
    mentor: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    recruitmentOpen: { type: Boolean, default: false },
    foundedDate: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Club', clubSchema);