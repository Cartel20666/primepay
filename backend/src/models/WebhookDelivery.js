const mongoose = require("mongoose");

const webhookDeliverySchema = new mongoose.Schema(
    {
        business: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Business",
            required: true,
            index: true
        },

        webhook: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Webhook",
            required: true,
            index: true
        },

        event: {
            type: String,
            required: true,
            trim: true,
            index: true
        },

        eventId: {
            type: String,
            required: true,
            trim: true
        },

        payload: {
            type: String,
            required: true
        },

        timestamp: {
            type: Number,
            required: true
        },

        status: {
            type: String,
            enum: [
                "pending",
                "processing",
                "delivered",
                "failed"
            ],
            default: "pending",
            index: true
        },

        attempts: {
            type: Number,
            default: 0,
            min: 0
        },

        nextAttemptAt: {
            type: Date,
            default: Date.now,
            index: true
        },

        lockedUntil: {
            type: Date,
            default: null,
            index: true
        },

        lockToken: {
            type: String,
            default: null,
            index: true
        },

        lastAttemptAt: {
            type: Date,
            default: null
        },

        deliveredAt: {
            type: Date,
            default: null
        },

        lastError: {
            type: String,
            default: null
        },

        responseStatusCode: {
            type: Number,
            default: null
        }
    },
    {
        timestamps: true
    }
);

webhookDeliverySchema.index({
    webhook: 1,
    eventId: 1
}, {
    unique: true
});

webhookDeliverySchema.index({
    status: 1,
    nextAttemptAt: 1
});

module.exports = mongoose.model(
    "WebhookDelivery",
    webhookDeliverySchema
);
