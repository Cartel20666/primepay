const {
    normalizeCurrency,
    isSupportedCurrency
} = require("../config/payment.config");

const validatePaymentInput = ({
    amount,
    currency,
    provider
}) => {
    if (
        amount === undefined ||
        amount === null ||
        amount === ""
    ) {
        throw new Error(
            "A valid payment amount is required."
        );
    }

    const numericAmount =
        Number(amount);

    if (
        !Number.isFinite(numericAmount) ||
        numericAmount < 1
    ) {
        throw new Error(
            "A valid payment amount is required."
        );
    }

    const normalizedCurrency =
        normalizeCurrency(currency);

    if (
        normalizedCurrency &&
        !isSupportedCurrency(
            normalizedCurrency
        )
    ) {
        throw new Error(
            `Currency "${normalizedCurrency}" is not supported.`
        );
    }

    if (
        !provider ||
        typeof provider !== "string" ||
        !provider.trim()
    ) {
        throw new Error(
            "Payment provider is required."
        );
    }

    return {
        amount: numericAmount,
        currency:
            normalizedCurrency,
        provider:
            provider.trim().toLowerCase()
    };
};

module.exports = {
    validatePaymentInput
};
