const mongoose = require('mongoose');

const eventRegistrationSchema = new mongoose.Schema({
    eventId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Event', 
        required: true 
    },
    profileId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Profile', 
        required: true 
    },
    registrationDate: { 
        type: Date, 
        default: Date.now 
    },
    status: { 
        type: String, 
        enum: ['registered', 'waitlisted', 'cancelled'], 
        default: 'registered' 
    }
}, { timestamps: true });

eventRegistrationSchema.index({ eventId: 1, profileId: 1 }, { unique: true });

module.exports = mongoose.model('EventRegistration', eventRegistrationSchema);