require("dotenv").config();

const mongoose = require("mongoose");

const Payment =
    require("./src/models/Payment");

const Transaction =
    require("./src/models/Transaction");

const LedgerEntry =
    require("./src/models/LedgerEntry");

const PlatformLedgerEntry =
    require("./src/models/PlatformLedgerEntry");

const FeeConfig =
    require("./src/models/FeeConfig");

const ProviderConfig =
    require("./src/models/ProviderConfig");

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
    "primepay-fee-test";

const businessId =
    new mongoose.Types.ObjectId(
        "6aa05c5f113e60632a0eea86"
    );

const testReference =
    `PP-FEE-${Date.now()}`;

const idempotencyKey =
    `fee-${Date.now()}`;

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
                `FEE-TXN-${Date.now()}`,

            providerReference:
                `FEE-REF-${reference}`,

            status:
                "processing",

            /*
             * Provider cost.
             * This MUST NOT become PrimePay revenue.
             */
            fee: 5,

            netAmount:
                Number(amount) - 5,

            settlementCurrency:
                currency,

            exchangeRate: 1,

            metadata: {
                test: true,
                testType:
                    "fee-accounting"
            }
        };
    },

    async verifyPayment() {
        return {
            status:
                "processing"
        };
    }
};

async function run() {
    let payment = null;
    let transaction = null;

    try {
        await mongoose.connect(
            process.env.MONGODB_URI
        );

        console.log(
            "MongoDB connected."
        );

        registerProvider(
            provider
        );

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

                setDefaultsOnInsert:
                    true
            }
        );

        /*
         * Configure a temporary 2% PrimePay fee.
         */
        await FeeConfig.findOneAndUpdate(
            {
                provider:
                    TEST_PROVIDER,

                currency:
                    "KES"
            },
            {
                provider:
                    TEST_PROVIDER,

                currency:
                    "KES",

                percentage:
                    2,

                fixedAmount:
                    0,

                minimumFee:
                    0,

                maximumFee:
                    null,

                feeBearer:
                    "merchant",

                active:
                    true
            },
            {
                upsert: true,

                returnDocument: "after",

                setDefaultsOnInsert:
                    true
            }
        );

        console.log(
            "Temporary 2% PrimePay fee configured."
        );

        /*
         * Gross payment = KES 100.
         * PrimePay fee = KES 2.
         * Provider test fee = KES 5.
         *
         * This test currently verifies PrimePay fee
         * accounting separately from provider cost.
         */
        const created =
            await createPayment({
                businessId,

                reference:
                    testReference,

                idempotencyKey,

                amount:
                    100,

                currency:
                    "KES",

                country:
                    "KE",

                provider:
                    TEST_PROVIDER,

                customerName:
                    "Fee Accounting Test",

                customerEmail:
                    "fee@test.local",

                description:
                    "PrimePay fee accounting integration test"
            });

        payment =
            created.payment;

        transaction =
            created.transaction;

        if (
            payment.status !==
                "processing" ||
            transaction.status !==
                "processing"
        ) {
            throw new Error(
                "Initial payment was not created in processing state."
            );
        }

        console.log(
            "\nINITIAL PAYMENT:"
        );

        console.log({
            amount:
                payment.amount,

            providerFee:
                payment.fee,

            providerNet:
                payment.netAmount
        });

        const completed =
            await synchronizePaymentStatus({
                payment,

                providerResult: {
                    success: true,

                    provider:
                        TEST_PROVIDER,

                    status:
                        "completed",

                    providerTransactionId:
                        payment.providerTransactionId,

                    providerReference:
                        payment.providerReference,

                    message:
                        "Payment completed"
                }
            });

        console.log(
            "\nCOMPLETION:"
        );

        console.log({
            status:
                completed.payment.status,

            transactionStatus:
                completed.transaction.status,

            fee:
                completed.payment.fee,

            netAmount:
                completed.payment.netAmount
        });

        /*
         * Reload from MongoDB.
         */
        const savedPayment =
            await Payment.findById(
                payment._id
            );

        const savedTransaction =
            await Transaction.findById(
                transaction._id
            );

        /*
         * Expected fee breakdown:
         *
         * Provider fee  = KES 5
         * PrimePay fee  = KES 2
         * Total fees    = KES 7
         *
         * Merchant net remains KES 98 because provider
         * cost is not yet charged to the merchant.
         */
        if (
            Number(savedPayment.primePayFee) !==
                2
        ) {
            throw new Error(
                `Expected PrimePay fee of 2, got ${savedPayment.primePayFee}.`
            );
        }

        if (
            Number(savedPayment.providerFee) !==
                5
        ) {
            throw new Error(
                `Expected provider fee of 5, got ${savedPayment.providerFee}.`
            );
        }

        if (
            Number(savedPayment.totalFee) !==
                7
        ) {
            throw new Error(
                `Expected total fee of 7, got ${savedPayment.totalFee}.`
            );
        }

        if (
            Number(savedPayment.fee) !==
                7
        ) {
            throw new Error(
                `Expected legacy fee field to equal total fee of 7, got ${savedPayment.fee}.`
            );
        }

        if (
            Number(savedPayment.netAmount) !==
                98
        ) {
            throw new Error(
                `Expected merchant net of 98, got ${savedPayment.netAmount}.`
            );
        }

        if (
            Number(savedTransaction.primePayFee) !==
                2
        ) {
            throw new Error(
                `Expected transaction PrimePay fee of 2, got ${savedTransaction.primePayFee}.`
            );
        }

        if (
            Number(savedTransaction.providerFee) !==
                5
        ) {
            throw new Error(
                `Expected transaction provider fee of 5, got ${savedTransaction.providerFee}.`
            );
        }

        if (
            Number(savedTransaction.totalFee) !==
                7
        ) {
            throw new Error(
                `Expected transaction total fee of 7, got ${savedTransaction.totalFee}.`
            );
        }

        if (
            Number(savedTransaction.fee) !==
                7
        ) {
            throw new Error(
                `Expected transaction legacy fee field to equal total fee of 7, got ${savedTransaction.fee}.`
            );
        }

        if (
            Number(savedTransaction.netAmount) !==
                98
        ) {
            throw new Error(
                `Expected transaction net of 98, got ${savedTransaction.netAmount}.`
            );
        }

        console.log(
            "PASS: Payment PrimePay fee = KES 2."
        );

        console.log(
            "PASS: Payment provider fee = KES 5."
        );

        console.log(
            "PASS: Payment total fee = KES 7."
        );

        console.log(
            "PASS: Merchant net amount = KES 98."
        );

        console.log(
            "PASS: Transaction fee breakdown = KES 2 + KES 5 = KES 7."
        );

        /*
         * Merchant gross ledger.
         */
        const merchantLedgerCount =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    `LEDGER-CREDIT-${testReference}`
            });

        if (
            merchantLedgerCount !==
                1
        ) {
            throw new Error(
                `Expected exactly one merchant ledger credit, got ${merchantLedgerCount}.`
            );
        }

        console.log(
            "PASS: Exactly one merchant ledger credit."
        );

        /*
         * PrimePay revenue ledger.
         */
        const platformEntries =
            await PlatformLedgerEntry.find({
                transaction:
                    transaction._id,

                category:
                    "primepay_fee_revenue"
            });

        if (
            platformEntries.length !==
                1
        ) {
            throw new Error(
                `Expected exactly one PrimePay revenue entry, got ${platformEntries.length}.`
            );
        }

        const platformEntry =
            platformEntries[0];

        if (
            Number(platformEntry.amount) !==
                2
        ) {
            throw new Error(
                `Expected PrimePay revenue of 2, got ${platformEntry.amount}.`
            );
        }

        if (
            platformEntry.type !==
                "credit"
        ) {
            throw new Error(
                "PrimePay fee revenue must be a platform credit."
            );
        }

        console.log(
            "PASS: Exactly one PrimePay revenue entry."
        );

        console.log(
            "PASS: PrimePay revenue = KES 2."
        );

        /*
         * Verify the provider's KES 5 fee did NOT
         * become PrimePay revenue.
         */
        if (
            Number(platformEntry.amount) ===
                5
        ) {
            throw new Error(
                "Provider cost was incorrectly recorded as PrimePay revenue."
            );
        }

        console.log(
            "PASS: Provider fee is not misclassified as PrimePay revenue."
        );

        /*
         * Provider cost ledger.
         *
         * Provider processing cost is a platform debit,
         * not PrimePay revenue.
         */
        const providerCostEntries =
            await PlatformLedgerEntry.find({
                transaction:
                    transaction._id,

                category:
                    "provider_cost"
            });

        if (
            providerCostEntries.length !==
                1
        ) {
            throw new Error(
                `Expected exactly one provider-cost entry, got ${providerCostEntries.length}.`
            );
        }

        const providerCostEntry =
            providerCostEntries[0];

        if (
            Number(providerCostEntry.amount) !==
                5
        ) {
            throw new Error(
                `Expected provider cost of 5, got ${providerCostEntry.amount}.`
            );
        }

        if (
            providerCostEntry.type !==
                "debit"
        ) {
            throw new Error(
                "Provider cost must be a platform debit."
            );
        }

        console.log(
            "PASS: Exactly one provider-cost entry."
        );

        console.log(
            "PASS: Provider cost = KES 5."
        );

        /*
         * Repeat the completion.
         *
         * The status remains completed and must not
         * create another platform revenue entry.
         */
        const repeated =
            await synchronizePaymentStatus({
                payment:
                    savedPayment,

                providerResult: {
                    success: true,

                    provider:
                        TEST_PROVIDER,

                    status:
                        "completed",

                    providerTransactionId:
                        payment.providerTransactionId,

                    providerReference:
                        payment.providerReference,

                    message:
                        "Repeated completion"
                }
            });

        const repeatedPlatformCount =
            await PlatformLedgerEntry.countDocuments({
                transaction:
                    transaction._id,

                category:
                    "primepay_fee_revenue"
            });

        if (
            repeatedPlatformCount !==
                1
        ) {
            throw new Error(
                "Repeated completion created duplicate PrimePay revenue."
            );
        }

        console.log(
            "PASS: Repeated completion did not duplicate PrimePay revenue."
        );

        /*
         * Refund the completed payment.
         *
         * The merchant gross credit must be reversed with
         * exactly one deterministic debit.
         */
        const refunded =
            await synchronizePaymentStatus({
                payment:
                    repeated.payment,

                providerResult: {
                    success: true,

                    provider:
                        TEST_PROVIDER,

                    status:
                        "refunded",

                    providerTransactionId:
                        payment.providerTransactionId,

                    providerReference:
                        payment.providerReference,

                    message:
                        "Payment refunded"
                }
            });

        if (
            refunded.payment.status !==
                "refunded" ||
            refunded.transaction.status !==
                "refunded"
        ) {
            throw new Error(
                "Payment did not transition from completed to refunded."
            );
        }

        const refundLedgerEntries =
            await LedgerEntry.find({
                business:
                    businessId,

                reference:
                    `LEDGER-DEBIT-REFUND-${testReference}`
            });

        if (
            refundLedgerEntries.length !==
                1
        ) {
            throw new Error(
                `Expected exactly one merchant refund debit, got ${refundLedgerEntries.length}.`
            );
        }

        const refundLedgerEntry =
            refundLedgerEntries[0];

        if (
            refundLedgerEntry.type !==
                "debit"
        ) {
            throw new Error(
                "Refund ledger entry must be a merchant debit."
            );
        }

        if (
            Number(refundLedgerEntry.amount) !==
                100
        ) {
            throw new Error(
                `Expected refund debit of 100, got ${refundLedgerEntry.amount}.`
            );
        }

        console.log(
            "PASS: Payment transitioned completed -> refunded."
        );

        console.log(
            "PASS: Exactly one merchant refund debit."
        );

        console.log(
            "PASS: Merchant refund debit = KES 100."
        );

        /*
         * Repeat the refund.
         *
         * The state remains refunded and the deterministic
         * refund reference must prevent another debit.
         */
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
                        payment.providerTransactionId,

                    providerReference:
                        payment.providerReference,

                    message:
                        "Repeated refund"
                }
            });

        const repeatedRefundCount =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    `LEDGER-DEBIT-REFUND-${testReference}`
            });

        if (
            repeatedRefundCount !==
                1
        ) {
            throw new Error(
                `Repeated refund created duplicate refund debit. Count: ${repeatedRefundCount}.`
            );
        }

        if (
            repeatedRefund.payment.status !==
                "refunded" ||
            repeatedRefund.transaction.status !==
                "refunded"
        ) {
            throw new Error(
                "Repeated refund changed the refunded state."
            );
        }

        console.log(
            "PASS: Repeated refund did not duplicate merchant refund debit."
        );

        /*
         * Fee and provider-cost ledgers must remain unchanged.
         * We do not reverse either one without confirmed recovery.
         */
        const finalPrimePayRevenueCount =
            await PlatformLedgerEntry.countDocuments({
                transaction:
                    transaction._id,

                category:
                    "primepay_fee_revenue"
            });

        const finalProviderCostCount =
            await PlatformLedgerEntry.countDocuments({
                transaction:
                    transaction._id,

                category:
                    "provider_cost"
            });

        if (
            finalPrimePayRevenueCount !==
                1
        ) {
            throw new Error(
                "Refund incorrectly duplicated or removed PrimePay revenue."
            );
        }

        if (
            finalProviderCostCount !==
                1
        ) {
            throw new Error(
                "Refund incorrectly duplicated or removed provider cost."
            );
        }

        console.log(
            "PASS: PrimePay revenue remains KES 2 after refund."
        );

        console.log(
            "PASS: Provider cost remains KES 5 after refund."
        );

        console.log(
            "\nFINAL DATABASE VERIFICATION:"
        );

        console.log({
            paymentStatus:
                repeated.payment.status,

            transactionStatus:
                repeated.transaction.status,

            primePayFee:
                savedPayment.primePayFee,

            providerFee:
                savedPayment.providerFee,

            totalFee:
                savedPayment.totalFee,

            merchantNet:
                savedPayment.netAmount,

            merchantLedgerEntries:
                merchantLedgerCount,

            platformRevenueEntries:
                finalPrimePayRevenueCount,

            platformRevenue:
                platformEntry.amount,

            providerCostEntries:
                finalProviderCostCount,

            providerCost:
                providerCostEntry.amount,

            merchantRefundEntries:
                repeatedRefundCount,

            merchantRefund:
                refundLedgerEntry.amount
        });

        console.log(
            "\nFEE ACCOUNTING TEST PASSED."
        );

    } catch (error) {
        console.error(
            "\nFEE ACCOUNTING TEST FAILED:"
        );

        console.error(
            error
        );

        process.exitCode =
            1;

    } finally {
        /*
         * Remove only this test's records.
         */
        if (payment) {
            await Payment.deleteOne({
                _id:
                    payment._id
            });

            await Transaction.deleteOne({
                _id:
                    transaction._id
            });
        }

        await LedgerEntry.deleteMany({
            reference:
                `LEDGER-CREDIT-${testReference}`
        });

        await LedgerEntry.deleteMany({
            reference:
                `LEDGER-DEBIT-REFUND-${testReference}`
        });

        await PlatformLedgerEntry.deleteMany({
            reference:
                `PRIMEPAY-FEE-${testReference}`
        });

        await PlatformLedgerEntry.deleteMany({
            reference:
                `PROVIDER-COST-${testReference}`
        });

        await FeeConfig.deleteOne({
            provider:
                TEST_PROVIDER,

            currency:
                "KES"
        });

        await ProviderConfig.deleteOne({
            provider:
                TEST_PROVIDER
        });

        await mongoose.disconnect();
    }
}

run();

