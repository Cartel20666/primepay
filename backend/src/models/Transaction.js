const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
    {
        business: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Business",
            required: true,
            index: true
        },

        type: {
            type: String,
            enum: [
                "payment",
                "refund",
                "payout",
                "deposit",
                "settlement"
            ],
            required: true,
            index: true
        },

        reference: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        provider: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true
        },

        providerTransactionId: {
            type: String,
            default: null,
            index: true
        },

        providerReference: {
            type: String,
            default: null,
            index: true
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
            trim: true,
            default: "KES",
            index: true
        },

        country: {
            type: String,
            uppercase: true,
            trim: true,
            default: null
        },

        paymentMethod: {
            type: String,
            trim: true,
            default: null
        },

        fee: {
            type: Number,
            default: 0,
            min: 0
        },

        primePayFee: {
            type: Number,
            default: 0,
            min: 0
        },

        providerFee: {
            type: Number,
            default: 0,
            min: 0
        },

        totalFee: {
            type: Number,
            default: 0,
            min: 0
        },

        netAmount: {
            type: Number,
            default: null,
            min: 0
        },

        settlementCurrency: {
            type: String,
            uppercase: true,
            trim: true,
            default: null
        },

        exchangeRate: {
            type: Number,
            default: null,
            min: 0
        },

        status: {
            type: String,
            enum: [
                "pending",
                "processing",
                "completed",
                "failed",
                "cancelled",
                "refunded"
            ],
            default: "pending",
            index: true
        },

        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
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

module.exports = mongoose.model("Transaction", transactionSchema);
