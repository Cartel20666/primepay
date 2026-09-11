const FeeConfig =
    require("../models/FeeConfig");

const roundMoney = (value) => {
    return Math.round(
        (Number(value) + Number.EPSILON) * 100
    ) / 100;
};

const calculatePrimePayFee = async ({
    provider,
    currency,
    amount
}) => {
    const normalizedProvider =
        String(provider || "")
            .trim()
            .toLowerCase();

    const normalizedCurrency =
        String(currency || "KES")
            .trim()
            .toUpperCase();

    const normalizedAmount =
        Number(amount);

    if (
        !Number.isFinite(normalizedAmount) ||
        normalizedAmount <= 0
    ) {
        throw new Error(
            "Payment amount must be greater than zero."
        );
    }

    const config =
        await FeeConfig.findOne({
            provider:
                normalizedProvider,
            currency:
                normalizedCurrency,
            active: true
        });

    /*
     * No configured PrimePay fee means
     * zero PrimePay revenue, never a fake fee.
     */
    if (!config) {
        return {
            configured: false,
            provider:
                normalizedProvider,
            currency:
                normalizedCurrency,
            grossAmount:
                roundMoney(normalizedAmount),
            percentage:
                0,
            fixedAmount:
                0,
            primePayFee:
                0,
            merchantNet:
                roundMoney(normalizedAmount),
            feeBearer:
                "merchant"
        };
    }

    let fee =
        (
            normalizedAmount *
            Number(config.percentage || 0)
        ) / 100;

    fee +=
        Number(config.fixedAmount || 0);

    if (
        Number(config.minimumFee || 0) > 0
    ) {
        fee = Math.max(
            fee,
            Number(config.minimumFee)
        );
    }

    if (
        config.maximumFee !== null &&
        config.maximumFee !== undefined
    ) {
        fee = Math.min(
            fee,
            Number(config.maximumFee)
        );
    }

    fee =
        roundMoney(fee);

    const merchantNet =
        roundMoney(
            Math.max(
                normalizedAmount - fee,
                0
            )
        );

    return {
        configured: true,

        provider:
            normalizedProvider,

        currency:
            normalizedCurrency,

        grossAmount:
            roundMoney(normalizedAmount),

        percentage:
            Number(config.percentage || 0),

        fixedAmount:
            Number(config.fixedAmount || 0),

        primePayFee:
            fee,

        merchantNet,

        feeBearer:
            config.feeBearer
    };
};

module.exports = {
    calculatePrimePayFee,
    roundMoney
};
