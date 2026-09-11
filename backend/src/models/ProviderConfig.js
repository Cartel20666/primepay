const mongoose = require("mongoose");

const providerConfigSchema =
    new mongoose.Schema(
        {
            provider: {
                type: String,
                required: true,
                lowercase: true,
                trim: true,
                unique: true,
                index: true
            },

            environment: {
                type: String,
                enum: ["sandbox", "production"],
                default: "sandbox"
            },

            active: {
                type: Boolean,
                default: false
            },

            configured: {
                type: Boolean,
                default: false
            },

            validated: {
                type: Boolean,
                default: false
            },

            credentialFingerprint: {
                type: String,
                default: null,
                select: false
            },

            lastValidatedAt: {
                type: Date,
                default: null
            },

            lastValidationError: {
                type: String,
                default: null
            },

            capabilities: {
                type: mongoose.Schema.Types.Mixed,
                default: {}
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
        "ProviderConfig",
        providerConfigSchema
    );
