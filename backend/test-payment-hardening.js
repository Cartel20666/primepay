require("dotenv").config();

const mongoose = require("mongoose");

const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");
const LedgerEntry = require("./src/models/LedgerEntry");
const ProviderConfig = require("./src/models/ProviderConfig");
const FeeConfig = require("./src/models/FeeConfig");
const PlatformLedgerEntry = require("./src/models/PlatformLedgerEntry");

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
    "primepay-hardening-test";

const businessId =
    new mongoose.Types.ObjectId(
        "6aa05c5f113e60632a0eea86"
    );

const runId =
    Date.now();

const providerCalls = {
    initiate: 0
};

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
        providerCalls.initiate += 1;

        return {
            success: true,

            providerTransactionId:
                `HARDEN-TXN-${reference}`,

            providerReference:
                `HARDEN-REF-${reference}`,

            status: "processing",

            fee: 5,

            netAmount:
                Number(amount) - 5,

            settlementCurrency:
                currency,

            exchangeRate: 1,

            metadata: {
                test: true,
                testType:
                    "payment-hardening"
            }
        };
    },

    async verifyPayment() {
        return {
            success: true,
            status: "processing"
        };
    }
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function createTestPayment({
    suffix,
    amount = 100,
    idempotencyKey
}) {
    return createPayment({
        businessId,

        reference:
            `PP-HARDEN-${runId}-${suffix}`,

        idempotencyKey:
            idempotencyKey ||
            `hardening-${runId}-${suffix}`,

        amount,

        currency: "KES",

        country: "KE",

        provider: TEST_PROVIDER,

        customerName:
            "PrimePay Hardening Test",

        customerEmail:
            "hardening@test.local",

        description:
            "PrimePay payment hardening integration test"
    });
}

async function run() {
    const payments = [];
    const transactions = [];

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

                environment:
                    "sandbox",

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

        await FeeConfig.findOneAndUpdate(
            {
                provider:
                    TEST_PROVIDER,

                currency: "KES"
            },
            {
                provider:
                    TEST_PROVIDER,

                currency: "KES",

                percentage: 2,

                fixedAmount: 0,

                minimumFee: 0,

                maximumFee: null,

                feeBearer: "merchant",

                active: true
            },
            {
                upsert: true,
                returnDocument: "after",
                setDefaultsOnInsert: true
            }
        );

        console.log(
            "Hardening test provider and fee configuration activated."
        );

        /*
         * ============================================================
         * 1. IDEMPOTENCY
         * ============================================================
         */

        const idempotencyKey =
            `hardening-idempotency-${runId}`;

        const first =
            await createTestPayment({
                suffix:
                    "IDEMPOTENCY",
                amount: 100,
                idempotencyKey
            });

        payments.push(first.payment);
        transactions.push(first.transaction);

        const initiateCallsAfterFirst =
            providerCalls.initiate;

        const replay =
            await createPayment({
                businessId,

                reference:
                    `PP-HARDEN-REPLAY-${runId}`,

                idempotencyKey,

                amount: 100,

                currency: "KES",

                country: "KE",

                provider: TEST_PROVIDER,

                customerName:
                    "PrimePay Hardening Test",

                customerEmail:
                    "hardening@test.local",

                description:
                    "PrimePay payment hardening integration test"
            });

        assert(
            replay.idempotentReplay === true,
            "Expected identical idempotent request to replay."
        );

        assert(
            String(replay.payment._id) ===
                String(first.payment._id),
            "Idempotent replay returned a different payment."
        );

        assert(
            providerCalls.initiate ===
                initiateCallsAfterFirst,
            "Idempotent replay called the provider again."
        );

        console.log(
            "✓ Same idempotency key + same payload replays safely"
        );

        let conflictRejected = false;

        try {
            await createPayment({
                businessId,

                reference:
                    `PP-HARDEN-CONFLICT-${runId}`,

                idempotencyKey,

                amount: 250,

                currency: "KES",

                country: "KE",

                provider: TEST_PROVIDER,

                customerName:
                    "PrimePay Hardening Test",

                customerEmail:
                    "hardening@test.local",

                description:
                    "Different payload"
            });
        } catch (error) {
            conflictRejected =
                error.name ===
                "IdempotencyConflictError" ||
                error.statusCode === 409;
        }

        assert(
            conflictRejected,
            "Different payload with same idempotency key was not rejected."
        );

        console.log(
            "✓ Same idempotency key + different payload is rejected"
        );

        /*
         * ============================================================
         * 2. COMPLETION + FINANCIAL ACCOUNTING
         * ============================================================
         */

        const completion =
            await createTestPayment({
                suffix:
                    "COMPLETION",
                amount: 100
            });

        payments.push(completion.payment);
        transactions.push(completion.transaction);

        const completionReference =
            completion.payment.reference;

        const completed =
            await synchronizePaymentStatus({
                payment:
                    completion.payment,

                providerResult: {
                    success: true,

                    provider:
                        TEST_PROVIDER,

                    status:
                        "completed",

                    providerTransactionId:
                        completion.payment
                            .providerTransactionId,

                    providerReference:
                        completion.payment
                            .providerReference,

                    message:
                        "Hardening completion"
                }
            });

        assert(
            completed.payment.status ===
                "completed",
            "Payment did not complete."
        );

        assert(
            completed.transaction.status ===
                "completed",
            "Transaction did not complete."
        );

        const merchantCreditReference =
            `LEDGER-CREDIT-${completionReference}`;

        const primePayFeeReference =
            `PRIMEPAY-FEE-${completionReference}`;

        const providerCostReference =
            `PROVIDER-COST-${completionReference}`;

        const merchantCredits =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    merchantCreditReference
            });

        const feeRevenue =
            await PlatformLedgerEntry.countDocuments({
                reference:
                    primePayFeeReference
            });

        const providerCosts =
            await PlatformLedgerEntry.countDocuments({
                reference:
                    providerCostReference
            });

        assert(
            merchantCredits === 1,
            `Expected 1 merchant credit, found ${merchantCredits}.`
        );

        assert(
            feeRevenue === 1,
            `Expected 1 PrimePay fee revenue entry, found ${feeRevenue}.`
        );

        assert(
            providerCosts === 1,
            `Expected 1 provider cost entry, found ${providerCosts}.`
        );

        console.log(
            "✓ Completion creates exactly one merchant credit"
        );

        console.log(
            "✓ Completion creates exactly one PrimePay fee entry"
        );

        console.log(
            "✓ Completion creates exactly one provider cost entry"
        );

        /*
         * Repeat completion.
         */

        const repeatedCompletion =
            await synchronizePaymentStatus({
                payment:
                    completed.payment,

                providerResult: {
                    success: true,

                    provider:
                        TEST_PROVIDER,

                    status:
                        "completed",

                    providerTransactionId:
                        completion.payment
                            .providerTransactionId,

                    providerReference:
                        completion.payment
                            .providerReference,

                    message:
                        "Repeated completion"
                }
            });

        const merchantCreditsAfterRepeat =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    merchantCreditReference
            });

        const feeRevenueAfterRepeat =
            await PlatformLedgerEntry.countDocuments({
                reference:
                    primePayFeeReference
            });

        const providerCostsAfterRepeat =
            await PlatformLedgerEntry.countDocuments({
                reference:
                    providerCostReference
            });

        assert(
            repeatedCompletion.payment.status ===
                "completed",
            "Repeated completion changed payment status."
        );

        assert(
            merchantCreditsAfterRepeat === 1,
            "Repeated completion created another merchant credit."
        );

        assert(
            feeRevenueAfterRepeat === 1,
            "Repeated completion created another PrimePay fee."
        );

        assert(
            providerCostsAfterRepeat === 1,
            "Repeated completion created another provider cost."
        );

        console.log(
            "✓ Repeated completion does not duplicate financial records"
        );

        /*
         * Verify fee numbers.
         */

        const savedPayment =
            await Payment.findById(
                completion.payment._id
            );

        assert(
            savedPayment.primePayFee === 2,
            `Expected PrimePay fee of 2, got ${savedPayment.primePayFee}.`
        );

        assert(
            savedPayment.providerFee === 5,
            `Expected provider fee of 5, got ${savedPayment.providerFee}.`
        );

        assert(
            savedPayment.totalFee === 7,
            `Expected total fee of 7, got ${savedPayment.totalFee}.`
        );

        assert(
            savedPayment.netAmount === 98,
            `Expected merchant net of 98, got ${savedPayment.netAmount}.`
        );

        console.log(
            "✓ Fee accounting is exactly 2 PrimePay + 5 provider = 7 total"
        );

        /*
         * ============================================================
         * 3. ILLEGAL STATE TRANSITIONS
         * ============================================================
         */

        const illegalTransitions = [
            "processing",
            "failed",
            "cancelled"
        ];

        for (
            const attemptedStatus of
            illegalTransitions
        ) {
            let rejected = false;

            try {
                await synchronizePaymentStatus({
                    payment:
                        savedPayment,

                    providerResult: {
                        success: true,

                        provider:
                            TEST_PROVIDER,

                        status:
                            attemptedStatus
                    }
                });
            } catch (error) {
                rejected =
                    error.message.includes(
                        '"completed" ->'
                    );
            }

            assert(
                rejected,
                `Illegal completed -> ${attemptedStatus} transition was accepted.`
            );
        }

        console.log(
            "✓ Illegal completed-state downgrades are rejected"
        );

        /*
         * ============================================================
         * 4. REFUND
         * ============================================================
         */

        const refunded =
            await synchronizePaymentStatus({
                payment:
                    savedPayment,

                providerResult: {
                    success: true,

                    provider:
                        TEST_PROVIDER,

                    status:
                        "refunded",

                    providerTransactionId:
                        savedPayment
                            .providerTransactionId,

                    providerReference:
                        savedPayment
                            .providerReference,

                    message:
                        "Hardening refund"
                }
            });

        assert(
            refunded.payment.status ===
                "refunded",
            "Payment did not transition to refunded."
        );

        const refundReference =
            `LEDGER-DEBIT-REFUND-${completionReference}`;

        const refundCount =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    refundReference
            });

        assert(
            refundCount === 1,
            `Expected one refund debit, found ${refundCount}.`
        );

        console.log(
            "✓ Completed payment creates exactly one refund debit"
        );

        const repeatedRefund =
            await synchronizePaymentStatus({
                payment:
                    refunded.payment,

                providerResult: {
                    success: true,

                    provider:
                        TEST_PROVIDER,

                    status:
                        "refunded",

                    providerTransactionId:
                        savedPayment
                            .providerTransactionId,

                    providerReference:
                        savedPayment
                            .providerReference,

                    message:
                        "Repeated refund"
                }
            });

        const refundCountAfterRepeat =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    refundReference
            });

        assert(
            repeatedRefund.payment.status ===
                "refunded",
            "Repeated refund changed payment status."
        );

        assert(
            refundCountAfterRepeat === 1,
            "Repeated refund created another refund debit."
        );

        console.log(
            "✓ Repeated refund does not duplicate the refund debit"
        );

        /*
         * ============================================================
         * 5. CONCURRENT COMPLETION
         * ============================================================
         */

        const concurrent =
            await createTestPayment({
                suffix:
                    "CONCURRENT",
                amount: 100
            });

        payments.push(concurrent.payment);
        transactions.push(concurrent.transaction);

        const concurrentProviderResult = {
            success: true,

            provider:
                TEST_PROVIDER,

            status:
                "completed",

            providerTransactionId:
                concurrent.payment
                    .providerTransactionId,

            providerReference:
                concurrent.payment
                    .providerReference,

            message:
                "Concurrent completion"
        };

        const concurrentResults =
            await Promise.allSettled([
                synchronizePaymentStatus({
                    payment:
                        concurrent.payment,

                    providerResult:
                        concurrentProviderResult
                }),

                synchronizePaymentStatus({
                    payment:
                        concurrent.payment,

                    providerResult:
                        concurrentProviderResult
                })
            ]);

        const concurrentReference =
            concurrent.payment.reference;

        const concurrentCreditCount =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    `LEDGER-CREDIT-${concurrentReference}`
            });

        const concurrentFeeCount =
            await PlatformLedgerEntry.countDocuments({
                reference:
                    `PRIMEPAY-FEE-${concurrentReference}`
            });

        const concurrentCostCount =
            await PlatformLedgerEntry.countDocuments({
                reference:
                    `PROVIDER-COST-${concurrentReference}`
            });

        assert(
            concurrentCreditCount === 1,
            `Concurrent completion produced ${concurrentCreditCount} merchant credits.`
        );

        assert(
            concurrentFeeCount === 1,
            `Concurrent completion produced ${concurrentFeeCount} PrimePay fee entries.`
        );

        assert(
            concurrentCostCount === 1,
            `Concurrent completion produced ${concurrentCostCount} provider cost entries.`
        );

        const concurrentPayment =
            await Payment.findById(
                concurrent.payment._id
            );

        const concurrentTransaction =
            await Transaction.findById(
                concurrent.transaction._id
            );

        assert(
            concurrentPayment.status ===
                "completed",
            "Concurrent payment did not finish completed."
        );

        assert(
            concurrentTransaction.status ===
                "completed",
            "Concurrent transaction did not finish completed."
        );

        console.log(
            "✓ Concurrent completion produces exactly one credit, fee, and provider cost"
        );

        console.log(
            "\n================================================"
        );

        console.log(
            "PAYMENT HARDENING TEST PASSED ✓"
        );

        console.log(
            "================================================"
        );

        console.log({
            providerInitiations:
                providerCalls.initiate,

            concurrentResults:
                concurrentResults.map(
                    result =>
                        result.status
                ),

            merchantCredit:
                concurrentCreditCount,

            primePayFee:
                concurrentFeeCount,

            providerCost:
                concurrentCostCount,

            refundDebit:
                refundCountAfterRepeat
        });
    } catch (error) {
        console.error(
            "\n================================================"
        );

        console.error(
            "PAYMENT HARDENING TEST FAILED ✗"
        );

        console.error(
            "================================================"
        );

        console.error(
            error.stack ||
            error.message
        );

        process.exitCode = 1;
    } finally {
        try {
            /*
             * Remove all test payments/transactions
             * belonging to this run.
             */

            const testReferences =
                payments
                    .map(
                        payment =>
                            payment.reference
                    )
                    .filter(Boolean);

            if (
                testReferences.length
            ) {
                await LedgerEntry.deleteMany({
                    business:
                        businessId,

                    $or: [
                        {
                            reference: {
                                $in:
                                    testReferences.map(
                                        reference =>
                                            `LEDGER-CREDIT-${reference}`
                                    )
                            }
                        },
                        {
                            reference: {
                                $in:
                                    testReferences.map(
                                        reference =>
                                            `LEDGER-DEBIT-REFUND-${reference}`
                                    )
                            }
                        }
                    ]
                });

                await PlatformLedgerEntry.deleteMany({
                    reference: {
                        $in:
                            testReferences.flatMap(
                                reference => [
                                    `PRIMEPAY-FEE-${reference}`,
                                    `PROVIDER-COST-${reference}`
                                ]
                            )
                    }
                });

                await Payment.deleteMany({
                    reference: {
                        $in:
                            testReferences
                    }
                });

                await Transaction.deleteMany({
                    reference: {
                        $in:
                            testReferences
                    }
                });
            }

            await Payment.deleteMany({
                business:
                    businessId,

                reference: {
                    $regex:
                        `^PP-HARDEN-${runId}-`
                }
            });

            await Transaction.deleteMany({
                business:
                    businessId,

                reference: {
                    $regex:
                        `^PP-HARDEN-${runId}-`
                }
            });

            await FeeConfig.deleteOne({
                provider:
                    TEST_PROVIDER
            });

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
