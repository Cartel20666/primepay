const ProviderConfig = require("../models/ProviderConfig");
const {
    getProvider
} = require("../providers/provider.registry");

const validateProviderCredentials = async (providerName) => {
    const provider = getProvider(providerName);

    const config = await ProviderConfig.findOne({
        provider: provider.name
    });

    if (!config) {
        throw new Error(
            `Provider configuration for "${provider.name}" does not exist.`
        );
    }

    if (!provider.isConfigured()) {
        config.configured = false;
        config.validated = false;
        config.active = false;
        config.lastValidationError = "Provider credentials are not configured.";
        await config.save();

        throw new Error("Provider credentials are not configured.");
    }

    if (typeof provider.validateCredentials !== "function") {
        config.configured = true;
        config.validated = false;
        config.lastValidationError =
            "Credential validation is not implemented for this provider.";
        await config.save();

        throw new Error(
            `Credential validation is not implemented for "${provider.name}".`
        );
    }

    try {
        const result = await provider.validateCredentials();

        config.configured = true;
        config.validated = true;
        config.active = false;
        config.lastValidatedAt = new Date();
        config.lastValidationError = null;

        await config.save();

        return {
            provider: provider.name,
            environment: config.environment,
            validated: true,
            active: config.active,
            lastValidatedAt: config.lastValidatedAt,
            result: result || null
        };
    } catch (error) {
        config.configured = true;
        config.validated = false;
        config.active = false;
        config.lastValidationError =
            error.response?.data?.message ||
            error.response?.data?.error_description ||
            error.message ||
            "Provider credential validation failed.";

        await config.save();

        throw new Error(config.lastValidationError);
    }
};

module.exports = {
    validateProviderCredentials
};
