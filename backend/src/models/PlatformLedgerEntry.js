const mongoose = require("mongoose");

const platformLedgerEntrySchema = new mongoose.Schema(
    {
        transaction: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Transaction",
            required: true,
            index: true
        },

        payment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
            index: true
        },

        type: {
            type: String,
            enum: ["credit", "debit"],
            required: true
        },

        category: {
            type: String,
            enum: [
                "primepay_fee_revenue",
                "provider_cost",
                "refund",
                "adjustment"
            ],
            required: true
        },

        amount: {
            type: Number,
            required: true,
            min: 0
        },

        currency: {
            type: String,
            uppercase: true,
            required: true,
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
            index: true,
            trim: true
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true
    }
);

module.exports =
    mongoose.model(
        "PlatformLedgerEntry",
        platformLedgerEntrySchema
    );
