const mongoose = require('mongoose');

const clubBudgetSchema = new mongoose.Schema({
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
    academicYear: { type: String, required: true, trim: true },
    totalAllocated: { type: Number, required: true, default: 0, min: 0 },
    totalSpent: { type: Number, required: true, default: 0, min: 0 }
}, { timestamps: true });

clubBudgetSchema.path('totalSpent').validate(function (value) {
    return value <= this.totalAllocated;
}, 'Total spent cannot exceed the allocated budget.');

clubBudgetSchema.index({ clubId: 1, academicYear: 1 }, { unique: true });

module.exports = mongoose.model('ClubBudget', clubBudgetSchema);