const {
    getProvider,
    getProviders
} = require("../providers/provider.registry");

const {
    getCapabilities
} = require("../providers/provider.interface");

const getProviderDetails = (
    providerName
) => {
    const provider =
        getProvider(providerName);

    return {
        name: provider.name,
        environment:
            provider.environment,
        configured:
            provider.isConfigured(),
        capabilities:
            getCapabilities(provider)
    };
};

const getAllProviderDetails = () => {
    return getProviders().map(
        provider => ({
            name: provider.name,
            environment:
                provider.environment,
            configured:
                provider.isConfigured(),
            capabilities:
                getCapabilities(provider)
        })
    );
};

module.exports = {
    getProviderDetails,
    getAllProviderDetails
};
