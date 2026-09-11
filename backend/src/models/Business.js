const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema(
    {
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        businessName: {
            type: String,
            required: true,
            trim: true
        },

        businessType: {
            type: String,
            enum: [
                "sole_proprietorship",
                "partnership",
                "limited_company",
                "organization",
                "other"
            ],
            default: "other"
        },

        registrationNumber: {
            type: String,
            trim: true
        },

        country: {
            type: String,
            default: "Kenya"
        },

        currency: {
            type: String,
            default: "KES"
        },

        verificationStatus: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending"
        },

        liveApiEnabled: {
            type: Boolean,
            default: false
        },

        suspended: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Business", businessSchema);
