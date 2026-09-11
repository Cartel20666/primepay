const crypto = require("crypto");

const ProviderConfig =
    require("../models/ProviderConfig");

const {
    getProvider,
    getProviders
} = require("../providers/provider.registry");

const {
    getCapabilities
} = require("../providers/provider.interface");

const getProviderCredentialFingerprint = (
    provider
) => {
    if (
        typeof provider.getCredentialFingerprint ===
        "function"
    ) {
        return provider.getCredentialFingerprint();
    }

    return null;
};

const syncProviderConfig = async (
    providerName
) => {
    const provider =
        getProvider(providerName);

    const capabilities =
        getCapabilities(provider);

    const configured =
        provider.isConfigured();

    const environment =
        provider.environment || "sandbox";

    const credentialFingerprint =
        getProviderCredentialFingerprint(
            provider
        );

    let config =
        await ProviderConfig.findOne({
            provider: provider.name
        }).select("+credentialFingerprint");

    if (!config) {
        config =
            await ProviderConfig.create({
                provider: provider.name,
                environment,
                configured,
                validated: false,
                active: false,
                credentialFingerprint,
                capabilities
            });

        return config;
    }

    const environmentChanged =
        config.environment !== environment;

    const credentialsChanged =
        credentialFingerprint !== null &&
        config.credentialFingerprint !== null &&
        config.credentialFingerprint !==
            credentialFingerprint;

    const fingerprintInitialized =
        credentialFingerprint !== null &&
        config.credentialFingerprint === null;

    config.environment =
        environment;

    config.configured =
        configured;

    config.capabilities =
        capabilities;

    if (
        environmentChanged ||
        credentialsChanged
    ) {
        config.validated =
            false;

        config.active =
            false;

        config.lastValidatedAt =
            null;

        config.lastValidationError =
            null;
    }

    if (
        configured &&
        fingerprintInitialized
    ) {
        config.credentialFingerprint =
            credentialFingerprint;

        config.validated =
            false;

        config.active =
            false;
    }

    if (!configured) {
        config.validated =
            false;

        config.active =
            false;

        config.lastValidatedAt =
            null;

        config.lastValidationError =
            null;
    }

    if (credentialFingerprint !== null) {
        config.credentialFingerprint =
            credentialFingerprint;
    }

    await config.save();

    return config;
};

const syncAllProviderConfigs =
    async () => {
        const providers =
            getProviders();

        const results = [];

        for (
            const provider of providers
        ) {
            const config =
                await syncProviderConfig(
                    provider.name
                );

            results.push(config);
        }

        return results;
    };

const getProviderConfig =
    async (providerName) => {
        return syncProviderConfig(
            providerName
        );
    };

const activateProvider =
    async (providerName) => {
        const config =
            await syncProviderConfig(
                providerName
            );

        if (!config.configured) {
            throw new Error(
                `Provider "${providerName}" cannot be activated because credentials are not configured.`
            );
        }

        if (!config.validated) {
            throw new Error(
                `Provider "${providerName}" cannot be activated before credentials are validated.`
            );
        }

        config.active =
            true;

        await config.save();

        return config;
    };

const deactivateProvider =
    async (providerName) => {
        const config =
            await syncProviderConfig(
                providerName
            );

        config.active =
            false;

        await config.save();

        return config;
    };

const isProviderActive =
    async (providerName) => {
        const config =
            await ProviderConfig.findOne({
                provider:
                    String(providerName)
                        .toLowerCase()
                        .trim()
            });

        return Boolean(
            config &&
            config.active &&
            config.configured &&
            config.validated
        );
    };

module.exports = {
    syncProviderConfig,
    syncAllProviderConfigs,
    getProviderConfig,
    activateProvider,
    deactivateProvider,
    isProviderActive
};
