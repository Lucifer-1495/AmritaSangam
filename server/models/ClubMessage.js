const mongoose = require('mongoose');

const clubMessageSchema = new mongoose.Schema({
  clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
  group: { type: String, enum: ['members', 'office_bearers'], required: true },
  content: { type: String, required: true, trim: true, maxlength: 2000 },
}, { timestamps: true });

clubMessageSchema.index({ clubId: 1, group: 1, createdAt: -1 });

module.exports = mongoose.model('ClubMessage', clubMessageSchema);
