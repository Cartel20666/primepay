const LedgerEntry = require("../models/LedgerEntry");

const createPaymentCredit = async ({
    businessId,
    transactionId,
    amount,
    currency,
    paymentReference
}) => {
    if (!businessId || !transactionId || !paymentReference) {
        throw new Error(
            "Ledger payment information is incomplete."
        );
    }

    if (
        !Number.isFinite(Number(amount)) ||
        Number(amount) < 1
    ) {
        throw new Error(
            "Ledger amount must be greater than zero."
        );
    }

    const reference =
        `LEDGER-CREDIT-${paymentReference}`;

    const existingEntry =
        await LedgerEntry.findOne({
            reference
        });

    if (existingEntry) {
        return {
            created: false,
            entry: existingEntry
        };
    }

    try {
        const entry =
            await LedgerEntry.create({
                business: businessId,
                transaction: transactionId,
                type: "credit",
                amount: Number(amount),
                currency:
                    String(currency || "KES")
                        .trim()
                        .toUpperCase(),
                description:
                    `Payment received: ${paymentReference}`,
                reference
            });

        return {
            created: true,
            entry
        };
    } catch (error) {
        /*
         * The unique ledger reference protects against
         * concurrent duplicate credits. If another request
         * created the same entry first, return that entry
         * instead of treating the retry as a failure.
         */
        if (error?.code === 11000) {
            const concurrentEntry =
                await LedgerEntry.findOne({
                    reference
                });

            if (concurrentEntry) {
                return {
                    created: false,
                    entry: concurrentEntry
                };
            }
        }

        throw error;
    }
};

const getBusinessBalance = async ({ businessId, currency = "KES" }) => {
    if (!businessId) {
        throw new Error("Business ID is required.");
    }

    const result = await LedgerEntry.aggregate([
        {
            $match: {
                business: new (require("mongoose").Types.ObjectId)(businessId),
                currency: String(currency).toUpperCase()
            }
        },
        {
            $group: {
                _id: "$type",
                total: { $sum: "$amount" }
            }
        }
    ]);

    let credits = 0;
    let debits = 0;

    for (const row of result) {
        if (row._id === "credit") credits = row.total;
        if (row._id === "debit") debits = row.total;
    }

    return {
        currency: String(currency).toUpperCase(),
        credits,
        debits,
        balance: credits - debits
    };
};

module.exports = {
    createPaymentCredit,
    getBusinessBalance
};
