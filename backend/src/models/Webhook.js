const mongoose = require("mongoose");

const webhookSchema = new mongoose.Schema(
    {
        business: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Business",
            required: true,
            index: true
        },

        url: {
            type: String,
            required: true,
            trim: true
        },

        events: {
            type: [String],
            default: []
        },

        secret: {
            type: String,
            required: true,
            select: false
        },

        active: {
            type: Boolean,
            default: true
        },

        lastDeliveryAt: {
            type: Date,
            default: null
        },

        failureCount: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Webhook", webhookSchema);
