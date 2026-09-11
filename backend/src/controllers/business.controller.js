const Business = require("../models/Business");
const BusinessApplication = require("../models/BusinessApplication");
const { getBusinessBalance } = require("../services/ledger.service");

const createBusiness = async (req, res) => {
    try {
        const {
            businessName,
            businessType,
            registrationNumber,
            country,
            currency
        } = req.body;

        if (!businessName) {
            return res.status(400).json({
                success: false,
                message: "Business name is required."
            });
        }

        const existingBusiness = await Business.findOne({
            owner: req.user._id
        });

        if (existingBusiness) {
            return res.status(409).json({
                success: false,
                message: "You already have a registered business."
            });
        }

        const business = await Business.create({
            owner: req.user._id,
            businessName: businessName.trim(),
            businessType,
            registrationNumber,
            country: country || "Kenya",
            currency: currency || "KES"
        });

        const application = await BusinessApplication.create({
            business: business._id,
            submittedBy: req.user._id
        });

        res.status(201).json({
            success: true,
            message: "Business registered and submitted for verification.",
            business,
            application
        });
    } catch (error) {
        console.error("Business creation error:", error);

        res.status(500).json({
            success: false,
            message: "Business registration failed."
        });
    }
};

const getMyBusiness = async (req, res) => {
    try {
        const business = await Business.findOne({
            owner: req.user._id
        });

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "No business profile found."
            });
        }

        res.json({
            success: true,
            business
        });
    } catch (error) {
        console.error("Business lookup error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve business profile."
        });
    }
};

const getMyBalance = async (req, res) => {
    try {
        const business = await Business.findOne({
            owner: req.user._id,
            suspended: false
        });

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "No active business profile found."
            });
        }

        const balance = await getBusinessBalance({
            businessId: business._id,
            currency: business.currency || "KES"
        });

        res.json({
            success: true,
            businessId: business._id,
            businessName: business.businessName,
            balance
        });
    } catch (error) {
        console.error("Business balance error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve business balance."
        });
    }
};

module.exports = {
    createBusiness,
    getMyBusiness,
    getMyBalance
};
