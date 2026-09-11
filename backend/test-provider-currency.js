require("dotenv").config();

const mongoose = require("mongoose");

const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");
const ProviderConfig = require("./src/models/ProviderConfig");

const {
    registerProvider,
    getProvider
} = require("./src/providers/provider.registry");

const {
    createPayment
} = require("./src/services/payment.service");

const {
    IdempotencyConflictError
} = require("./src/errors/idempotency.error");

const TEST_PROVIDER = "primepay-currency-test";

const businessId =
    new mongoose.Types.ObjectId(
        "6aa05c5f113e60632a0eea86"
    );

const provider = {
    name: TEST_PROVIDER,

    environment: "sandbox",

    supportedCurrencies: [
        "KES"
    ],

    capabilities: {
        payments: true,
        cardPayments: false,
        bankPayments: false,
        mobileMoney: false,
        verification: true,
        refunds: false,
        payouts: false,
        webhooks: false,
        subscriptions: false
    },

    isConfigured() {
        return true;
    },

    async initiatePayment({
        reference,
        amount,
        currency
    }) {
        return {
            success: true,

            providerTransactionId:
                `CURRENCY-TXN-${Date.now()}`,

            providerReference:
                `CURRENCY-REF-${reference}`,

            status: "processing",

            fee: 0,

            netAmount: amount,

            settlementCurrency:
                currency,

            exchangeRate: 1,

            metadata: {
                test: true,
                testType:
                    "provider-currency"
            }
        };
    },

    async verifyPayment() {
        return {
            status: "processing"
        };
    }
};

async function run() {
    let registered = false;

    try {
        await mongoose.connect(
            process.env.MONGODB_URI
        );

        console.log(
            "MongoDB connected."
        );

        registerProvider(provider);
        registered = true;

        await ProviderConfig.findOneAndUpdate(
            {
                provider: TEST_PROVIDER
            },
            {
                provider: TEST_PROVIDER,
                environment: "sandbox",
                active: true,
                configured: true,
                validated: true,
                capabilities:
                    provider.capabilities
            },
            {
                upsert: true,
                returnDocument: "after",
                setDefaultsOnInsert: true
            }
        );

        console.log(
            "Temporary currency-test provider activated."
        );

        /*
         * Verify the provider itself exposes
         * the expected currency contract.
         */
        const registeredProvider =
            getProvider(TEST_PROVIDER);

        if (
            !registeredProvider.supportedCurrencies.includes(
                "KES"
            )
        ) {
            throw new Error(
                "Test provider does not declare KES."
            );
        }

        console.log(
            "Provider currency declaration: PASS"
        );

        /*
         * Unsupported currency must fail before
         * a transaction is created.
         */
        const unsupportedKey =
            `currency-unsupported-${Date.now()}`;

        let unsupportedRejected =
            false;

        try {
            await createPayment({
                businessId,

                reference:
                    `PP-CURRENCY-UNSUPPORTED-${Date.now()}`,

                idempotencyKey:
                    unsupportedKey,

                amount: 100,

                currency: "USD",

                country: "KE",

                provider: TEST_PROVIDER,

                customerName:
                    "Currency Test",

                customerEmail:
                    "currency@test.local",

                description:
                    "Unsupported currency integration test"
            });
        } catch (error) {
            unsupportedRejected =
                error.message ===
                'Payment provider "primepay-currency-test" does not support currency "USD".';

            console.log(
                "\nUNSUPPORTED CURRENCY TEST:"
            );

            console.log({
                rejected:
                    unsupportedRejected,
                message:
                    error.message
            });
        }

        if (!unsupportedRejected) {
            throw new Error(
                "Unsupported currency was not rejected correctly."
            );
        }

        const unsupportedTransactions =
            await Transaction.countDocuments({
                business: businessId,
                reference: {
                    $regex:
                        "^PP-CURRENCY-UNSUPPORTED-"
                }
            });

        if (
            unsupportedTransactions !== 0
        ) {
            throw new Error(
                "A transaction was created for an unsupported currency."
            );
        }

        console.log(
            "No transaction created for unsupported currency: PASS"
        );

        /*
         * Supported currency must reach the provider.
         */
        const supportedReference =
            `PP-CURRENCY-SUPPORTED-${Date.now()}`;

        const supportedKey =
            `currency-supported-${Date.now()}`;

        const result =
            await createPayment({
                businessId,

                reference:
                    supportedReference,

                idempotencyKey:
                    supportedKey,

                amount: 100,

                currency: "KES",

                country: "KE",

                provider: TEST_PROVIDER,

                customerName:
                    "Currency Test",

                customerEmail:
                    "currency@test.local",

                description:
                    "Supported currency integration test"
            });

        console.log(
            "\nSUPPORTED CURRENCY TEST:"
        );

        console.log({
            created:
                Boolean(result.payment),

            transactionCreated:
                Boolean(result.transaction),

            idempotentReplay:
                result.idempotentReplay,

            currency:
                result.payment?.currency,

            provider:
                result.payment?.provider
        });

        if (
            !result.payment ||
            !result.transaction ||
            result.payment.currency !== "KES" ||
            result.payment.provider !==
                TEST_PROVIDER
        ) {
            throw new Error(
                "Supported currency payment was not created correctly."
            );
        }

        console.log(
            "Supported currency reached payment engine: PASS"
        );

        console.log(
            "\nPROVIDER CURRENCY TEST PASSED."
        );
    } catch (error) {
        console.error(
            "\nPROVIDER CURRENCY TEST FAILED:"
        );

        console.error(
            error.message
        );

        process.exitCode = 1;
    } finally {
        try {
            await Payment.deleteMany({
                business: businessId,
                provider: TEST_PROVIDER
            });

            await Transaction.deleteMany({
                business: businessId,
                reference: {
                    $regex:
                        "^PP-CURRENCY-"
                }
            });

            await ProviderConfig.deleteOne({
                provider: TEST_PROVIDER
            });

            if (registered) {
                console.log(
                    "Test data cleaned up."
                );
            }

            await mongoose.disconnect();
        } catch (cleanupError) {
            console.error(
                "Cleanup error:",
                cleanupError.message
            );
        }
    }
}

run();
