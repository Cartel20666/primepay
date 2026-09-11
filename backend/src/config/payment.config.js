const SUPPORTED_CURRENCIES = [
    "KES",
    "USD",
    "EUR",
    "GBP"
];

const normalizeCurrency = (currency) => {
    if (!currency) {
        return null;
    }

    return String(currency)
        .trim()
        .toUpperCase();
};

const isSupportedCurrency = (currency) => {
    return SUPPORTED_CURRENCIES.includes(
        normalizeCurrency(currency)
    );
};

module.exports = {
    SUPPORTED_CURRENCIES,
    normalizeCurrency,
    isSupportedCurrency
};
