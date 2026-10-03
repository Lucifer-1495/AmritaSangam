const mongoose = require('mongoose');

const clubMemberSchema = new mongoose.Schema({
    clubId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Club', 
        required: true 
    },
    profileId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Profile', 
        required: true 
    },
    position: {
        type: String,
        enum: ['member', 'executive', 'office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'],
        default: 'member',
    },
    membershipStatus: { type: String, enum: ['pending', 'active', 'declined'], default: 'active' },
    priorPosition: { type: String, enum: ['member', 'executive', 'office_bearer', 'president', 'vice_president', 'treasurer', 'secretary'] },
    priorPositionTitle: { type: String, trim: true, maxlength: 80 },
    priorOfficeBearerGroup: { type: Boolean },
    hadPriorMembership: { type: Boolean, default: false },
    positionTitle: { type: String, trim: true, maxlength: 80, default: '' },
    officeBearerGroup: { type: Boolean, default: false },
    joinedDate: { 
        type: Date, 
        default: Date.now 
    }
}, { timestamps: true });

clubMemberSchema.index({ clubId: 1, profileId: 1 }, { unique: true });

module.exports = mongoose.model('ClubMember', clubMemberSchema);