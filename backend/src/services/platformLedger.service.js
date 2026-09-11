const PlatformLedgerEntry =
    require("../models/PlatformLedgerEntry");

const createPrimePayFeeRevenue = async ({
    transactionId,
    paymentId,
    paymentReference,
    amount,
    currency,
    session = null
}) => {
    if (!transactionId) {
        throw new Error(
            "transactionId is required."
        );
    }

    if (!paymentReference) {
        throw new Error(
            "paymentReference is required."
        );
    }

    if (
        !Number.isFinite(Number(amount)) ||
        Number(amount) <= 0
    ) {
        throw new Error(
            "PrimePay revenue amount must be greater than zero."
        );
    }

    const reference =
        `PRIMEPAY-FEE-${paymentReference}`;

    const existing =
        await PlatformLedgerEntry.findOne({
            reference
        }).session(session);

    if (existing) {
        return existing;
    }

    try {
        const [entry] =
            await PlatformLedgerEntry.create(
                [
                    {
                        transaction:
                            transactionId,

                        payment:
                            paymentId || null,

                        type:
                            "credit",

                        category:
                            "primepay_fee_revenue",

                        amount:
                            Number(amount),

                        currency:
                            String(currency || "KES")
                                .toUpperCase(),

                        description:
                            `PrimePay transaction fee revenue for ${paymentReference}`,

                        reference,

                        metadata: {
                            paymentReference
                        }
                    }
                ],
                session
                    ? { session }
                    : undefined
            );

        return entry;
    } catch (error) {
        if (
            error &&
            error.code === 11000
        ) {
            return PlatformLedgerEntry
                .findOne({ reference })
                .session(session);
        }

        throw error;
    }
};

const createProviderCost = async ({
    transactionId,
    paymentId,
    paymentReference,
    amount,
    currency,
    session = null
}) => {
    if (!transactionId) {
        throw new Error(
            "transactionId is required."
        );
    }

    if (!paymentReference) {
        throw new Error(
            "paymentReference is required."
        );
    }

    if (
        !Number.isFinite(Number(amount)) ||
        Number(amount) <= 0
    ) {
        throw new Error(
            "Provider cost amount must be greater than zero."
        );
    }

    const reference =
        `PROVIDER-COST-${paymentReference}`;

    const existing =
        await PlatformLedgerEntry
            .findOne({ reference })
            .session(session);

    if (existing) {
        return existing;
    }

    try {
        const [entry] =
            await PlatformLedgerEntry.create(
                [
                    {
                        transaction:
                            transactionId,

                        payment:
                            paymentId || null,

                        type:
                            "debit",

                        category:
                            "provider_cost",

                        amount:
                            Number(amount),

                        currency:
                            String(currency || "KES")
                                .toUpperCase(),

                        description:
                            `Provider processing cost for ${paymentReference}`,

                        reference,

                        metadata: {
                            paymentReference
                        }
                    }
                ],
                session
                    ? { session }
                    : undefined
            );

        return entry;
    } catch (error) {
        if (
            error &&
            error.code === 11000
        ) {
            return PlatformLedgerEntry
                .findOne({ reference })
                .session(session);
        }

        throw error;
    }
};

module.exports = {
    createPrimePayFeeRevenue,
    createProviderCost
};
