require("dotenv").config();

const mongoose = require("mongoose");

const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");
const LedgerEntry = require("./src/models/LedgerEntry");
const ProviderConfig = require("./src/models/ProviderConfig");

const {
    registerProvider
} = require("./src/providers/provider.registry");

const {
    createPayment
} = require("./src/services/payment.service");

const {
    synchronizePaymentStatus
} = require("./src/services/paymentStatus.service");

const TEST_PROVIDER =
    "primepay-state-test";

const businessId =
    new mongoose.Types.ObjectId(
        "6aa05c5f113e60632a0eea86"
    );

const provider = {
    name: TEST_PROVIDER,

    environment: "sandbox",

    supportedCurrencies: ["KES"],

    capabilities: {
        payments: true,
        cardPayments: false,
        bankPayments: false,
        mobileMoney: false,
        verification: true,
        refunds: true,
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
            provider: this.name,
            providerTransactionId:
                `STATE-TXN-${Date.now()}`,
            providerReference:
                `STATE-REF-${reference}`,
            status: "processing",
            fee: 0,
            netAmount: amount,
            settlementCurrency: currency,
            exchangeRate: 1
        };
    },

    async verifyPayment() {
        return {
            success: true,
            provider: this.name,
            status: "processing"
        };
    }
};

const assertStatus = async ({
    payment,
    expected,
    label
}) => {
    const freshPayment =
        await Payment.findById(
            payment._id
        );

    const transaction =
        await Transaction.findById(
            freshPayment.transaction
        );

    if (
        freshPayment.status !== expected ||
        transaction.status !== expected
    ) {
        throw new Error(
            `${label}: expected Payment and Transaction to be "${expected}".`
        );
    }

    console.log(
        `PASS: ${label} -> ${expected}`
    );

    return {
        payment:
            freshPayment,
        transaction
    };
};

const expectRejected = async ({
    payment,
    status,
    label
}) => {
    let rejected = false;

    try {
        await synchronizePaymentStatus({
            payment,
            providerResult: {
                provider:
                    TEST_PROVIDER,
                status
            }
        });
    } catch (error) {
        rejected = true;

        console.log(
            `PASS: ${label} -> rejected`
        );

        console.log(
            `  ${error.message}`
        );
    }

    if (!rejected) {
        throw new Error(
            `${label}: illegal transition "${payment.status}" -> "${status}" was accepted.`
        );
    }

    return Payment.findById(
        payment._id
    );
};

const createTestPayment = async (
    suffix
) => {
    const reference =
        `PP-STATE-${Date.now()}-${suffix}`;

    const result =
        await createPayment({
            businessId,
            reference,
            idempotencyKey:
                `state-${Date.now()}-${suffix}`,
            amount: 100,
            currency: "KES",
            country: "KE",
            provider: TEST_PROVIDER,
            customerName:
                "State Machine Test",
            customerEmail:
                "state@test.local",
            description:
                `PrimePay state machine test ${suffix}`
        });

    return result.payment;
};

async function run() {
    const createdPayments = [];

    try {
        await mongoose.connect(
            process.env.MONGODB_URI
        );

        console.log(
            "MongoDB connected."
        );

        registerProvider(provider);

        await ProviderConfig.findOneAndUpdate(
            {
                provider:
                    TEST_PROVIDER
            },
            {
                provider:
                    TEST_PROVIDER,
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
            "Temporary state-test provider activated.\n"
        );

        /*
         * PROCESSING → COMPLETED
         */
        let payment =
            await createTestPayment(
                "completed"
            );

        createdPayments.push(payment);

        await assertStatus({
            payment,
            expected: "processing",
            label:
                "Initial processing"
        });

        await synchronizePaymentStatus({
            payment,
            providerResult: {
                provider:
                    TEST_PROVIDER,
                status: "completed"
            }
        });

        payment =
            (
                await assertStatus({
                    payment,
                    expected:
                        "completed",
                    label:
                        "Processing to completed"
                })
            ).payment;

        /*
         * COMPLETED → PROCESSING
         */
        payment =
            await expectRejected({
                payment,
                status: "processing",
                label:
                    "Completed to processing"
            });

        /*
         * COMPLETED → FAILED
         */
        payment =
            await expectRejected({
                payment,
                status: "failed",
                label:
                    "Completed to failed"
            });

        /*
         * COMPLETED → CANCELLED
         */
        payment =
            await expectRejected({
                payment,
                status: "cancelled",
                label:
                    "Completed to cancelled"
            });

        /*
         * COMPLETED → REFUNDED
         *
         * This is currently expected to succeed
         * at the status-machine level.
         */
        await synchronizePaymentStatus({
            payment,
            providerResult: {
                provider:
                    TEST_PROVIDER,
                status: "refunded"
            }
        });

        payment =
            (
                await assertStatus({
                    payment,
                    expected: "refunded",
                    label:
                        "Completed to refunded"
                })
            ).payment;

        /*
         * REFUNDED → COMPLETED
         */
        payment =
            await expectRejected({
                payment,
                status: "completed",
                label:
                    "Refunded to completed"
            });

        /*
         * REFUNDED → PROCESSING
         */
        payment =
            await expectRejected({
                payment,
                status: "processing",
                label:
                    "Refunded to processing"
            });

        /*
         * PROCESSING → FAILED
         */
        let failedPayment =
            await createTestPayment(
                "failed"
            );

        createdPayments.push(
            failedPayment
        );

        await synchronizePaymentStatus({
            payment:
                failedPayment,
            providerResult: {
                provider:
                    TEST_PROVIDER,
                status: "failed"
            }
        });

        failedPayment =
            (
                await assertStatus({
                    payment:
                        failedPayment,
                    expected: "failed",
                    label:
                        "Processing to failed"
                })
            ).payment;

        /*
         * FAILED → PROCESSING
         */
        failedPayment =
            await expectRejected({
                payment:
                    failedPayment,
                status: "processing",
                label:
                    "Failed to processing"
            });

        /*
         * FAILED → COMPLETED
         */
        failedPayment =
            await expectRejected({
                payment:
                    failedPayment,
                status: "completed",
                label:
                    "Failed to completed"
            });

        /*
         * PROCESSING → CANCELLED
         */
        let cancelledPayment =
            await createTestPayment(
                "cancelled"
            );

        createdPayments.push(
            cancelledPayment
        );

        await synchronizePaymentStatus({
            payment:
                cancelledPayment,
            providerResult: {
                provider:
                    TEST_PROVIDER,
                status: "cancelled"
            }
        });

        cancelledPayment =
            (
                await assertStatus({
                    payment:
                        cancelledPayment,
                    expected:
                        "cancelled",
                    label:
                        "Processing to cancelled"
                })
            ).payment;

        /*
         * CANCELLED → COMPLETED
         */
        cancelledPayment =
            await expectRejected({
                payment:
                    cancelledPayment,
                status: "completed",
                label:
                    "Cancelled to completed"
            });

        /*
         * CANCELLED → PROCESSING
         */
        cancelledPayment =
            await expectRejected({
                payment:
                    cancelledPayment,
                status: "processing",
                label:
                    "Cancelled to processing"
            });

        /*
         * Ledger integrity.
         *
         * Only the completed payment should have
         * received a payment credit.
         */
        const completedPayment =
            createdPayments[0];

        const ledgerEntries =
            await LedgerEntry.find({
                business: businessId,
                transaction:
                    completedPayment.transaction
            });

        console.log(
            "\nLEDGER VERIFICATION:"
        );

        const creditEntries =
            ledgerEntries.filter(
                entry =>
                    entry.type === "credit"
            );

        const debitEntries =
            ledgerEntries.filter(
                entry =>
                    entry.type === "debit"
            );

        console.log({
            totalLedgerEntries:
                ledgerEntries.length,
            creditEntries:
                creditEntries.length,
            debitEntries:
                debitEntries.length
        });

        if (
            creditEntries.length !== 1 ||
            debitEntries.length !== 1 ||
            ledgerEntries.length !== 2
        ) {
            throw new Error(
                "State machine test created an invalid number or type of ledger entries."
            );
        }

        console.log(
            "PASS: Exactly one payment credit and one refund debit were created."
        );

        console.log(
            "\nPAYMENT STATE MACHINE TEST PASSED."
        );
    } catch (error) {
        console.error(
            "\nPAYMENT STATE MACHINE TEST FAILED:"
        );

        console.error(
            error.message
        );

        process.exitCode = 1;
    } finally {
        try {
            for (
                const payment
                of createdPayments
            ) {
                if (!payment?._id) {
                    continue;
                }

                await LedgerEntry.deleteMany({
                    transaction:
                        payment.transaction
                });

                await Payment.deleteOne({
                    _id: payment._id
                });

                await Transaction.deleteOne({
                    _id:
                        payment.transaction
                });
            }

            await ProviderConfig.deleteOne({
                provider:
                    TEST_PROVIDER
            });

            await mongoose.disconnect();

            console.log(
                "Test data cleaned up."
            );
        } catch (cleanupError) {
            console.error(
                "Cleanup error:",
                cleanupError.message
            );
        }
    }
}

run();
