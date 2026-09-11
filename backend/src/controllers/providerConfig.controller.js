const {
    getAllProviderDetails
} = require("../services/provider.service");

const {
    getProviderConfig,
    activateProvider,
    deactivateProvider
} = require("../services/providerConfig.service");

const getProviders = async (req, res) => {
    try {
        const providers =
            await getAllProviderDetails();

        const configs = [];

        for (const provider of providers) {
            const config =
                await getProviderConfig(
                    provider.name
                );

            configs.push({
                provider:
                    config.provider,

                environment:
                    config.environment,

                configured:
                    config.configured,

                validated:
                    config.validated,

                active:
                    config.active,

                capabilities:
                    config.capabilities,

                lastValidatedAt:
                    config.lastValidatedAt,

                lastValidationError:
                    config.lastValidationError
            });
        }

        return res.json({
            success: true,
            providers: configs
        });
    } catch (error) {
        console.error(
            "Provider listing error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to retrieve provider configuration."
        });
    }
};

const getProvider = async (req, res) => {
    try {
        const config =
            await getProviderConfig(
                req.params.provider
            );

        return res.json({
            success: true,
            provider: {
                provider:
                    config.provider,

                environment:
                    config.environment,

                configured:
                    config.configured,

                validated:
                    config.validated,

                active:
                    config.active,

                capabilities:
                    config.capabilities,

                lastValidatedAt:
                    config.lastValidatedAt,

                lastValidationError:
                    config.lastValidationError
            }
        });
    } catch (error) {
        console.error(
            "Provider configuration lookup error:",
            error
        );

        return res.status(404).json({
            success: false,
            message:
                error.message ||
                "Provider not found."
        });
    }
};

const activate = async (req, res) => {
    try {
        const config =
            await activateProvider(
                req.params.provider
            );

        return res.json({
            success: true,
            message:
                `Provider "${config.provider}" activated.`,
            provider: {
                provider:
                    config.provider,
                environment:
                    config.environment,
                configured:
                    config.configured,
                validated:
                    config.validated,
                active:
                    config.active,
                capabilities:
                    config.capabilities
            }
        });
    } catch (error) {
        console.error(
            "Provider activation error:",
            error
        );

        return res.status(400).json({
            success: false,
            message:
                error.message ||
                "Unable to activate provider."
        });
    }
};

const deactivate = async (req, res) => {
    try {
        const config =
            await deactivateProvider(
                req.params.provider
            );

        return res.json({
            success: true,
            message:
                `Provider "${config.provider}" deactivated.`,
            provider: {
                provider:
                    config.provider,
                environment:
                    config.environment,
                configured:
                    config.configured,
                validated:
                    config.validated,
                active:
                    config.active,
                capabilities:
                    config.capabilities
            }
        });
    } catch (error) {
        console.error(
            "Provider deactivation error:",
            error
        );

        return res.status(400).json({
            success: false,
            message:
                error.message ||
                "Unable to deactivate provider."
        });
    }
};

module.exports = {
    getProviders,
    getProvider,
    activate,
    deactivate
};
