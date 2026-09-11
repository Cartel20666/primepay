const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
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

        reference: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        idempotencyKey: {
            type: String,
            required: function () {
                return this.isNew;
            },
            trim: true,
            default: null
        },

        requestFingerprint: {
            type: String,
            default: null,
            index: true
        },

        amount: {
            type: Number,
            required: true,
            min: 1
        },

        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
            default: "KES"
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

        provider: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
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

        reconciliationStatus: {
            type: String,
            enum: [
                "not_required",
                "pending",
                "processing",
                "resolved",
                "exhausted"
            ],
            default: "not_required",
            index: true
        },

        reconciliationAttempts: {
            type: Number,
            default: 0,
            min: 0
        },

        nextReconciliationAt: {
            type: Date,
            default: null,
            index: true
        },

        lastReconciliationAt: {
            type: Date,
            default: null
        },

        reconciliationLockUntil: {
            type: Date,
            default: null
        },

        reconciliationLockToken: {
            type: String,
            default: null
        },

        reconciliationLastStatus: {
            type: String,
            default: null
        },

        reconciliationLastError: {
            type: String,
            default: null
        },

        reconciliationLastErrorAt: {
            type: Date,
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

        customerName: {
            type: String,
            trim: true,
            default: null
        },

        customerEmail: {
            type: String,
            lowercase: true,
            trim: true,
            default: null
        },

        customerPhone: {
            type: String,
            trim: true,
            default: null
        },

        description: {
            type: String,
            trim: true,
            default: null
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },

        checkoutRequestId: {
            type: String,
            default: null,
            index: true
        },

        merchantRequestId: {
            type: String,
            default: null,
            index: true
        }
    },
    {
        timestamps: true
    }
);

paymentSchema.index(
    {
        business: 1,
        idempotencyKey: 1
    },
    {
        unique: true,
        partialFilterExpression: {
            idempotencyKey: {
                $type: "string"
            }
        },
        name: "business_1_idempotencyKey_1"
    }
);

module.exports = mongoose.model("Payment", paymentSchema);
