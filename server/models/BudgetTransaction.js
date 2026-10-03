const mongoose = require('mongoose');

const budgetTransactionSchema = new mongoose.Schema({
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
    fundingRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'FundingRequest' },
    amount: { type: Number, required: true, min: 0.01 },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    transactionDate: { type: Date, default: Date.now }
}, { timestamps: true });

budgetTransactionSchema.index(
    { fundingRequestId: 1 },
    { unique: true, partialFilterExpression: { fundingRequestId: { $exists: true } } }
);

module.exports = mongoose.model('BudgetTransaction', budgetTransactionSchema);