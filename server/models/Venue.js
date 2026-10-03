const mongoose = require('mongoose');

const venueSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    capacity: { 
        type: Number,
        required: true,
        min: 1,
    },
    location: { 
        type: String,
        required: true,
        trim: true,
    },
    isAvailable: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

module.exports = mongoose.model('Venue', venueSchema);