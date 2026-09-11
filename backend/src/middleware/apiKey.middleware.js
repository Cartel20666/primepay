const bcrypt = require("bcryptjs");

const ApiKey = require("../models/ApiKey");
const Business = require("../models/Business");

const authenticateApiKey = async (req, res, next) => {
    try {
        const apiKey = req.headers["x-api-key"];
        const apiSecret = req.headers["x-api-secret"];

        if (
            typeof apiKey !== "string" ||
            typeof apiSecret !== "string" ||
            !apiKey.trim() ||
            !apiSecret.trim()
        ) {
            return res.status(401).json({
                success: false,
                message: "API key and secret are required."
            });
        }

        const normalizedApiKey = apiKey.trim();
        const normalizedApiSecret = apiSecret.trim();

        if (normalizedApiKey.length > 100) {
            return res.status(401).json({
                success: false,
                message: "Invalid API credentials."
            });
        }

        if (normalizedApiSecret.length > 200) {
            return res.status(401).json({
                success: false,
                message: "Invalid API credentials."
            });
        }

        const keyMatch =
            normalizedApiKey.match(
                /^pk_(test|live)_([a-f0-9]{48})$/
            );

        if (!keyMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid API credentials."
            });
        }

        const keyRecord = await ApiKey.findOne({
            keyId: normalizedApiKey,
            active: true
        }).select("+secretHash");

        if (!keyRecord) {
            return res.status(401).json({
                success: false,
                message: "Invalid API credentials."
            });
        }

        const keyEnvironment =
            keyMatch[1] === "live"
                ? "live"
                : "sandbox";

        if (
            keyRecord.environment !== keyEnvironment
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid API credentials."
            });
        }

        const secretValid = await bcrypt.compare(
            normalizedApiSecret,
            keyRecord.secretHash
        );

        if (!secretValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid API credentials."
            });
        }

        const business = await Business.findOne({
            _id: keyRecord.business,
            suspended: false
        });

        if (!business) {
            return res.status(403).json({
                success: false,
                message: "Business is unavailable."
            });
        }

        if (
            keyRecord.environment === "live" &&
            (
                business.verificationStatus !== "approved" ||
                !business.liveApiEnabled
            )
        ) {
            return res.status(403).json({
                success: false,
                message: "Live API access is not enabled."
            });
        }

        keyRecord.lastUsedAt = new Date();
        await keyRecord.save();

        req.apiKey = keyRecord;
        req.business = business;

        next();
    } catch (error) {
        console.error(
            "API key authentication error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "API authentication failed."
        });
    }
};

module.exports = {
    authenticateApiKey
};
