const requiredMethods = [
    "initiatePayment",
    "verifyPayment",
    "isConfigured"
];

const supportedCapabilities = [
    "payments",
    "cardPayments",
    "bankPayments",
    "mobileMoney",
    "verification",
    "refunds",
    "payouts",
    "webhooks",
    "subscriptions",
    "recovery"
];

const normalizeCurrencies = (currencies) => {
    if (!Array.isArray(currencies)) {
        throw new Error(
            "Provider supportedCurrencies must be an array."
        );
    }

    if (currencies.length === 0) {
        throw new Error(
            "Provider supportedCurrencies cannot be empty."
        );
    }

    const normalized = currencies.map((currency) => {
        if (
            typeof currency !== "string" ||
            !currency.trim()
        ) {
            throw new Error(
                "Provider supportedCurrencies must contain valid currency codes."
            );
        }

        return currency.trim().toUpperCase();
    });

    if (new Set(normalized).size !== normalized.length) {
        throw new Error(
            "Provider supportedCurrencies cannot contain duplicates."
        );
    }

    return normalized;
};

const validateProvider = (provider) => {
    if (!provider || typeof provider !== "object") {
        throw new Error("Invalid payment provider.");
    }

    for (const method of requiredMethods) {
        if (typeof provider[method] !== "function") {
            throw new Error(
                `Payment provider "${provider.name || "unknown"}" is missing ${method}().`
            );
        }
    }

    if (!provider.name) {
        throw new Error(
            "Payment provider name is required."
        );
    }

    if (
        provider.capabilities !== undefined &&
        (
            typeof provider.capabilities !== "object" ||
            Array.isArray(provider.capabilities)
        )
    ) {
        throw new Error(
            `Payment provider "${provider.name}" has invalid capabilities.`
        );
    }

    if (provider.capabilities) {
        for (const capability of Object.keys(
            provider.capabilities
        )) {
            if (
                !supportedCapabilities.includes(
                    capability
                )
            ) {
                throw new Error(
                    `Payment provider "${provider.name}" declares unsupported capability "${capability}".`
                );
            }

            if (
                typeof provider.capabilities[capability] !==
                "boolean"
            ) {
                throw new Error(
                    `Payment provider "${provider.name}" capability "${capability}" must be boolean.`
                );
            }
        }

        if (
            provider.capabilities.recovery === true &&
            typeof provider.findPaymentByReference !==
                "function"
        ) {
            throw new Error(
                `Payment provider "${provider.name}" declares recovery capability but is missing findPaymentByReference().`
            );
        }
    }

    provider.supportedCurrencies =
        normalizeCurrencies(
            provider.supportedCurrencies
        );

    return true;
};

const hasCapability = (
    provider,
    capability
) => {
    if (!provider || !capability) {
        return false;
    }

    return provider.capabilities?.[capability] === true;
};

const requireCapability = (
    provider,
    capability
) => {
    if (!hasCapability(provider, capability)) {
        throw new Error(
            `Payment provider "${provider?.name || "unknown"}" does not support "${capability}".`
        );
    }

    return true;
};

const getCapabilities = (
    provider
) => {
    if (!provider) {
        return {};
    }

    return {
        ...(provider.capabilities || {})
    };
};

const supportsCurrency = (
    provider,
    currency
) => {
    if (
        !provider ||
        !currency ||
        !Array.isArray(
            provider.supportedCurrencies
        )
    ) {
        return false;
    }

    return provider.supportedCurrencies.includes(
        String(currency)
            .trim()
            .toUpperCase()
    );
};

const requireCurrency = (
    provider,
    currency
) => {
    if (
        !supportsCurrency(
            provider,
            currency
        )
    ) {
        throw new Error(
            `Payment provider "${provider?.name || "unknown"}" does not support currency "${String(currency || "").toUpperCase()}".`
        );
    }

    return true;
};

const getSupportedCurrencies = (
    provider
) => {
    if (
        !provider ||
        !Array.isArray(
            provider.supportedCurrencies
        )
    ) {
        return [];
    }

    return [
        ...provider.supportedCurrencies
    ];
};

module.exports = {
    validateProvider,
    hasCapability,
    requireCapability,
    getCapabilities,
    supportsCurrency,
    requireCurrency,
    getSupportedCurrencies,
    supportedCapabilities
};
