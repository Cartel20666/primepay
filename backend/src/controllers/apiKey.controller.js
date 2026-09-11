const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const ApiKey = require("../models/ApiKey");
const Business = require("../models/Business");

const generateKey = (environment) => {
    const prefix = environment === "live" ? "pk_live_" : "pk_test_";
    return prefix + crypto.randomBytes(24).toString("hex");
};

const generateSecret = () => {
    return crypto.randomBytes(48).toString("hex");
};

const findOwnedBusiness = async userId => {
    return Business.findOne({
        owner: userId
    });
};

const validateEnvironment = environment => {
    return ["sandbox", "live"].includes(environment);
};

const validateKeyName = name => {
    if (typeof name !== "string") {
        return false;
    }

    const normalized = name.trim();

    return (
        normalized.length >= 1 &&
        normalized.length <= 100
    );
};

const ensureLiveAccess = business => {
    return (
        business.verificationStatus === "approved" &&
        business.liveApiEnabled === true
    );
};

const createApiKey = async (req, res) => {
    try {
        const {
            name,
            environment = "sandbox"
        } = req.body || {};

        if (!validateKeyName(name)) {
            return res.status(400).json({
                success: false,
                message: "API key name must be between 1 and 100 characters."
            });
        }

        if (!validateEnvironment(environment)) {
            return res.status(400).json({
                success: false,
                message: "Invalid API environment."
            });
        }

        const business = await findOwnedBusiness(
            req.user._id
        );

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "Business profile not found."
            });
        }

        if (business.suspended) {
            return res.status(403).json({
                success: false,
                message: "Business is suspended."
            });
        }

        if (
            environment === "live" &&
            !ensureLiveAccess(business)
        ) {
            return res.status(403).json({
                success: false,
                message: "Live API access has not been approved."
            });
        }

        const keyId = generateKey(environment);
        const secret = generateSecret();
        const secretHash = await bcrypt.hash(secret, 12);

        const apiKey = await ApiKey.create({
            business: business._id,
            name: name.trim(),
            environment,
            keyId,
            secretHash
        });

        return res.status(201).json({
            success: true,
            message:
                "API key created. Store the secret securely; it will not be shown again.",
            apiKey: {
                id: apiKey._id,
                name: apiKey.name,
                environment: apiKey.environment,
                keyId: apiKey.keyId,
                secret
            }
        });
    } catch (error) {
        console.error(
            "API key creation error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to create API key."
        });
    }
};

const listApiKeys = async (req, res) => {
    try {
        const business = await findOwnedBusiness(
            req.user._id
        );

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "Business profile not found."
            });
        }

        const apiKeys = await ApiKey.find({
            business: business._id
        })
            .select(
                "_id name environment keyId active lastUsedAt createdAt updatedAt"
            )
            .sort({
                createdAt: -1
            })
            .lean();

        return res.json({
            success: true,
            apiKeys
        });
    } catch (error) {
        console.error(
            "API key listing error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve API keys."
        });
    }
};

const revokeApiKey = async (req, res) => {
    try {
        const business = await findOwnedBusiness(
            req.user._id
        );

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "Business profile not found."
            });
        }

        const apiKey = await ApiKey.findOne({
            _id: req.params.id,
            business: business._id
        });

        if (!apiKey) {
            return res.status(404).json({
                success: false,
                message: "API key not found."
            });
        }

        if (!apiKey.active) {
            return res.status(409).json({
                success: false,
                message: "API key is already revoked."
            });
        }

        apiKey.active = false;

        await apiKey.save();

        return res.json({
            success: true,
            message: "API key revoked.",
            apiKey: {
                id: apiKey._id,
                name: apiKey.name,
                environment: apiKey.environment,
                keyId: apiKey.keyId,
                active: false
            }
        });
    } catch (error) {
        console.error(
            "API key revocation error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to revoke API key."
        });
    }
};

const rotateApiKey = async (req, res) => {
    try {
        const business = await findOwnedBusiness(
            req.user._id
        );

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "Business profile not found."
            });
        }

        if (business.suspended) {
            return res.status(403).json({
                success: false,
                message: "Business is suspended."
            });
        }

        const apiKey = await ApiKey.findOne({
            _id: req.params.id,
            business: business._id
        });

        if (!apiKey) {
            return res.status(404).json({
                success: false,
                message: "API key not found."
            });
        }

        if (!apiKey.active) {
            return res.status(409).json({
                success: false,
                message: "Cannot rotate a revoked API key."
            });
        }

        if (
            apiKey.environment === "live" &&
            !ensureLiveAccess(business)
        ) {
            return res.status(403).json({
                success: false,
                message: "Live API access is not enabled."
            });
        }

        const keyId = generateKey(
            apiKey.environment
        );

        const secret = generateSecret();

        const secretHash = await bcrypt.hash(
            secret,
            12
        );

        apiKey.keyId = keyId;
        apiKey.secretHash = secretHash;
        apiKey.lastUsedAt = null;

        await apiKey.save();

        return res.json({
            success: true,
            message:
                "API key rotated. Store the new secret securely; it will not be shown again.",
            apiKey: {
                id: apiKey._id,
                name: apiKey.name,
                environment: apiKey.environment,
                keyId: apiKey.keyId,
                secret
            }
        });
    } catch (error) {
        console.error(
            "API key rotation error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to rotate API key."
        });
    }
};

module.exports = {
    createApiKey,
    listApiKeys,
    revokeApiKey,
    rotateApiKey
};
