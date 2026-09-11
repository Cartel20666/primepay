const mongoose = require("mongoose");

const ledgerEntrySchema = new mongoose.Schema(
    {
        business: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Business",
            required: true,
            index: true
        },

        transaction: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Transaction",
            default: null
        },

        type: {
            type: String,
            enum: ["credit", "debit"],
            required: true
        },

        amount: {
            type: Number,
            required: true,
            min: 0
        },

        currency: {
            type: String,
            required: true,
            uppercase: true,
            default: "KES"
        },

        description: {
            type: String,
            required: true,
            trim: true
        },

        reference: {
            type: String,
            required: true,
            unique: true,
            index: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("LedgerEntry", ledgerEntrySchema);
