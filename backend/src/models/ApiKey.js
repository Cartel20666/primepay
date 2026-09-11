const mongoose = require("mongoose");

const apiKeySchema = new mongoose.Schema(
    {
        business: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Business",
            required: true
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        environment: {
            type: String,
            enum: ["sandbox", "live"],
            required: true
        },

        keyId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        secretHash: {
            type: String,
            required: true,
            select: false
        },

        active: {
            type: Boolean,
            default: true
        },

        lastUsedAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("ApiKey", apiKeySchema);
