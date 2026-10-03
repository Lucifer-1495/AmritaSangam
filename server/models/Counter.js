const mongoose = require('mongoose');

// One document per ID prefix (e.g. "FA23CSE", "CSE23") holding the last number issued.
const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', counterSchema);
