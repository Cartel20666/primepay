const mongoose = require("mongoose");

const feeConfigSchema = new mongoose.Schema(
    {
        provider: {
            type: String,
            lowercase: true,
            trim: true,
            default: null,
            index: true
        },

        currency: {
            type: String,
            uppercase: true,
            trim: true,
            required: true,
            default: "KES",
            index: true
        },

        percentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
            default: 0
        },

        fixedAmount: {
            type: Number,
            min: 0,
            default: 0
        },

        minimumFee: {
            type: Number,
            min: 0,
            default: 0
        },

        maximumFee: {
            type: Number,
            min: 0,
            default: null
        },

        feeBearer: {
            type: String,
            enum: [
                "merchant",
                "customer"
            ],
            default: "merchant"
        },

        active: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        timestamps: true
    }
);

feeConfigSchema.index(
    {
        provider: 1,
        currency: 1,
        active: 1
    }
);

module.exports =
    mongoose.model(
        "FeeConfig",
        feeConfigSchema
    );
