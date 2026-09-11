const { validateProvider } = require("./provider.interface");

const mpesaProvider =
    require("./mpesa/mpesa.provider");

const stripeProvider =
    require("./stripe/stripe.provider");

const paypalProvider =
    require("./paypal/paypal.provider");

const dlocalProvider =
    require("./dlocal/dlocal.provider");

const providers = {
    mpesa: mpesaProvider,
    stripe: stripeProvider,
    paypal: paypalProvider,
    dlocal: dlocalProvider
};

Object.values(providers).forEach(
    validateProvider
);

const normalizeProviderName = (name) => {
    if (!name || typeof name !== "string") {
        throw new Error(
            "Payment provider name is required."
        );
    }

    return name.toLowerCase().trim();
};

const getProvider = (name) => {
    const providerName =
        normalizeProviderName(name);

    const provider =
        providers[providerName];

    if (!provider) {
        throw new Error(
            `Payment provider "${providerName}" is not registered.`
        );
    }

    return provider;
};

const registerProvider = (provider) => {
    validateProvider(provider);

    const providerName =
        normalizeProviderName(provider.name);

    if (providers[providerName]) {
        throw new Error(
            `Payment provider "${providerName}" is already registered.`
        );
    }

    providers[providerName] = provider;
};

const getProviders = () => {
    return Object.values(providers);
};

const getProviderNames = () => {
    return Object.keys(providers);
};

const hasProvider = (name) => {
    if (!name || typeof name !== "string") {
        return false;
    }

    return Boolean(
        providers[
            name.toLowerCase().trim()
        ]
    );
};

module.exports = {
    getProvider,
    registerProvider,
    getProviders,
    getProviderNames,
    hasProvider
};
