const mongoose = require("mongoose");

const providerWebhookEventSchema =
    new mongoose.Schema(
        {
            provider: {
                type: String,
                required: true,
                lowercase: true,
                trim: true,
                index: true
            },

            eventId: {
                type: String,
                required: true,
                trim: true
            },

            eventType: {
                type: String,
                default: null,
                trim: true
            },

            paymentReference: {
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
                    "received",
                    "processed",
                    "ignored",
                    "failed"
                ],
                default: "received",
                index: true
            },

            payload: {
                type: mongoose.Schema.Types.Mixed,
                default: null
            },

            error: {
                type: String,
                default: null
            },

            processedAt: {
                type: Date,
                default: null
            },

            processingAt: {
                type: Date,
                default: null,
                index: true
            },

            processingToken: {
                type: String,
                default: null
            }
        },
        {
            timestamps: true
        }
    );

providerWebhookEventSchema.index(
    {
        provider: 1,
        eventId: 1
    },
    {
        unique: true
    }
);

module.exports =
    mongoose.model(
        "ProviderWebhookEvent",
        providerWebhookEventSchema
    );
