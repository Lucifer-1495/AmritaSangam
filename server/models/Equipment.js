const mongoose = require('mongoose');

const equipmentSchema = new mongoose.Schema({
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    totalQuantity: { type: Number, required: true, default: 1, min: 0 },
    availableQuantity: { type: Number, required: true, default: 1, min: 0 },
    condition: { type: String, enum: ['new', 'good', 'fair', 'poor'], default: 'good' }
}, { timestamps: true });

equipmentSchema.path('availableQuantity').validate(function (value) {
    return value <= this.totalQuantity;
}, 'Available quantity cannot exceed total quantity.');

module.exports = mongoose.model('Equipment', equipmentSchema);