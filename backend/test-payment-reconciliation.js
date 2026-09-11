require("dotenv").config();

const mongoose = require("mongoose");

const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");
const LedgerEntry = require("./src/models/LedgerEntry");
const ProviderConfig = require("./src/models/ProviderConfig");
const FeeConfig = require("./src/models/FeeConfig");
const PlatformLedgerEntry = require("./src/models/PlatformLedgerEntry");
const WebhookDelivery = require("./src/models/WebhookDelivery");

const {
    registerProvider
} = require("./src/providers/provider.registry");

const {
    createPayment
} = require("./src/services/payment.service");

const {
    recoverPayment
} = require("./src/services/paymentReconciliation.service");

const {
    claimNextPayment
} = require("./src/workers/paymentReconciliation.worker");

const TEST_PROVIDER =
    "primepay-reconciliation-test";

const businessId =
    new mongoose.Types.ObjectId(
        "6aa05c5f113e60632a0eea86"
    );

const runId = Date.now();

const providerState = {
    verifyStatus: "completed",
    recoveryStatus: "completed",
    verifyCalls: 0,
    recoveryCalls: 0
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
        refunds: false,
        payouts: false,
        webhooks: true,
        subscriptions: false,
        recovery: true
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
                `RECON-TXN-${reference}`,

            providerReference:
                `RECON-REF-${reference}`,

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
                    "payment-reconciliation"
            }
        };
    },

    async verifyPayment() {
        providerState.verifyCalls += 1;

        return {
            success: true,
            provider: TEST_PROVIDER,
            status:
                providerState.verifyStatus
        };
    },

    async findPaymentByReference(
        reference
    ) {
        providerState.recoveryCalls += 1;

        return {
            success: true,
            provider: TEST_PROVIDER,
            status:
                providerState.recoveryStatus,

            providerTransactionId:
                `RECOVERY-TXN-${reference}`,

            providerReference:
                `RECOVERY-REF-${reference}`
        };
    }
};

function assert(
    condition,
    message
) {
    if (!condition) {
        throw new Error(message);
    }
}

async function createTestPayment({
    suffix,
    amount = 100
}) {
    return createPayment({
        businessId,

        reference:
            `PP-RECON-${runId}-${suffix}`,

        idempotencyKey:
            `reconciliation-${runId}-${suffix}`,

        amount,

        currency: "KES",

        country: "KE",

        provider: TEST_PROVIDER,

        customerName:
            "PrimePay Reconciliation Test",

        customerEmail:
            "reconciliation@test.local",

        description:
            "PrimePay payment reconciliation integration test"
    });
}

async function configureTestProvider() {
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
}

async function markForReconciliation(
    payment
) {
    await Payment.updateOne(
        {
            _id: payment._id
        },
        {
            $set: {
                status: "processing",

                reconciliationStatus:
                    "pending",

                reconciliationAttempts: 0,

                nextReconciliationAt:
                    null,

                reconciliationLockUntil:
                    null,

                reconciliationLockToken:
                    null
            }
        }
    );
}

async function run() {
    const paymentIds = [];
    const transactionIds = [];

    try {
        await mongoose.connect(
            process.env.MONGODB_URI
        );

        console.log(
            "MongoDB connected."
        );

        await configureTestProvider();

        console.log(
            "Reconciliation test provider configured."
        );

        /*
         * ============================================================
         * 1. KNOWN PROVIDER REFERENCE -> COMPLETED
         * ============================================================
         */

        providerState.verifyStatus =
            "completed";

        providerState.verifyCalls = 0;

        const known =
            await createTestPayment({
                suffix:
                    "KNOWN-REFERENCE"
            });

        paymentIds.push(
            known.payment._id
        );

        transactionIds.push(
            known.transaction._id
        );

        await markForReconciliation(
            known.payment
        );

        const knownResult =
            await recoverPayment(
                known.payment._id.toString()
            );

        assert(
            knownResult.success === true,
            "Known-reference reconciliation did not succeed."
        );

        assert(
            knownResult.status ===
                "completed",
            `Expected completed status, got ${knownResult.status}.`
        );

        assert(
            providerState.verifyCalls === 1,
            `Expected one provider verification call, got ${providerState.verifyCalls}.`
        );

        const knownPayment =
            await Payment.findById(
                known.payment._id
            );

        assert(
            knownPayment.status ===
                "completed",
            "Known-reference payment was not completed."
        );

        const knownCreditCount =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    `LEDGER-CREDIT-${known.payment.reference}`
            });

        assert(
            knownCreditCount === 1,
            `Expected one merchant credit, got ${knownCreditCount}.`
        );

        console.log(
            "✓ Known provider reference reconciles to completed"
        );

        /*
         * ============================================================
         * 2. RECOVERY BY PRIMEPAY REFERENCE
         * ============================================================
         */

        providerState.recoveryStatus =
            "completed";

        providerState.recoveryCalls = 0;

        const recovery =
            await createTestPayment({
                suffix:
                    "RECOVERY"
            });

        paymentIds.push(
            recovery.payment._id
        );

        transactionIds.push(
            recovery.transaction._id
        );

        await Payment.updateOne(
            {
                _id:
                    recovery.payment._id
            },
            {
                $set: {
                    providerReference:
                        null,

                    providerTransactionId:
                        null,

                    checkoutRequestId:
                        null,

                    merchantRequestId:
                        null,

                    status:
                        "processing",

                    reconciliationStatus:
                        "pending",

                    reconciliationAttempts:
                        0,

                    nextReconciliationAt:
                        null,

                    reconciliationLockUntil:
                        null,

                    reconciliationLockToken:
                        null
                }
            }
        );

        const recoveryResult =
            await recoverPayment(
                recovery.payment._id.toString()
            );

        assert(
            recoveryResult.success === true,
            "Reference recovery did not succeed."
        );

        assert(
            recoveryResult.status ===
                "completed",
            `Expected recovered payment to complete, got ${recoveryResult.status}.`
        );

        assert(
            providerState.recoveryCalls === 1,
            `Expected one recovery call, got ${providerState.recoveryCalls}.`
        );

        const recoveredPayment =
            await Payment.findById(
                recovery.payment._id
            );

        assert(
            recoveredPayment.status ===
                "completed",
            "Recovered payment was not completed."
        );

        const recoveryCreditCount =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    `LEDGER-CREDIT-${recovery.payment.reference}`
            });

        assert(
            recoveryCreditCount === 1,
            `Expected one recovery merchant credit, got ${recoveryCreditCount}.`
        );

        console.log(
            "✓ Payment can be recovered by PrimePay reference"
        );

        /*
         * ============================================================
         * 3. PROVIDER PROCESSING -> RETRYABLE STATE
         * ============================================================
         */

        providerState.verifyStatus =
            "processing";

        providerState.verifyCalls = 0;

        const retry =
            await createTestPayment({
                suffix:
                    "RETRY"
            });

        paymentIds.push(
            retry.payment._id
        );

        transactionIds.push(
            retry.transaction._id
        );

        await markForReconciliation(
            retry.payment
        );

        const retryResult =
            await recoverPayment(
                retry.payment._id.toString()
            );

        assert(
            retryResult.success === true,
            "Processing verification should synchronize successfully."
        );

        assert(
            retryResult.status ===
                "processing",
            `Expected processing status, got ${retryResult.status}.`
        );

        const retryPayment =
            await Payment.findById(
                retry.payment._id
            );

        assert(
            retryPayment.status ===
                "processing",
            "Processing payment unexpectedly changed state."
        );

        const retryCreditCount =
            await LedgerEntry.countDocuments({
                business:
                    businessId,

                reference:
                    `LEDGER-CREDIT-${retry.payment.reference}`
            });

        assert(
            retryCreditCount === 0,
            "Processing reconciliation created a merchant credit."
        );

        console.log(
            "✓ Provider processing state remains retryable"
        );

        /*
         * ============================================================
         * 4. RECOVERY NOT FOUND
         * ============================================================
         */

        providerState.recoveryStatus =
            "not_found";

        providerState.recoveryCalls = 0;

        const notFound =
            await createTestPayment({
                suffix:
                    "NOT-FOUND"
            });

        paymentIds.push(
            notFound.payment._id
        );

        transactionIds.push(
            notFound.transaction._id
        );

        await Payment.updateOne(
            {
                _id:
                    notFound.payment._id
            },
            {
                $set: {
                    providerReference:
                        null,

                    providerTransactionId:
                        null,

                    checkoutRequestId:
                        null,

                    merchantRequestId:
                        null,

                    status:
                        "processing",

                    reconciliationStatus:
                        "pending",

                    reconciliationAttempts:
                        0,

                    nextReconciliationAt:
                        null
                }
            }
        );

        const notFoundResult =
            await recoverPayment(
                notFound.payment._id.toString()
            );

        assert(
            notFoundResult.success ===
                false,
            "Not-found recovery unexpectedly succeeded."
        );

        assert(
            notFoundResult.status ===
                "not_found",
            `Expected not_found, got ${notFoundResult.status}.`
        );

        assert(
            providerState.recoveryCalls === 1,
            "Expected exactly one recovery attempt."
        );

        console.log(
            "✓ Missing provider payment remains retryable"
        );

        /*
         * ============================================================
         * 5. LOCK SAFETY
         * ============================================================
         */

        const locked =
            await createTestPayment({
                suffix:
                    "LOCK"
            });

        paymentIds.push(
            locked.payment._id
        );

        transactionIds.push(
            locked.transaction._id
        );

        const futureLock =
            new Date(
                Date.now() + 60000
            );

        await Payment.updateOne(
            {
                _id:
                    locked.payment._id
            },
            {
                $set: {
                    status:
                        "processing",

                    reconciliationStatus:
                        "processing",

                    reconciliationLockUntil:
                        futureLock,

                    reconciliationLockToken:
                        "ACTIVE-TEST-LOCK",

                    nextReconciliationAt:
                        null
                }
            }
        );

        const lockedClaim =
            await claimNextPayment();

        assert(
            !lockedClaim ||
                String(
                    lockedClaim._id
                ) !==
                    String(
                        locked.payment._id
                    ),
            "Worker claimed a payment whose reconciliation lock was still valid."
        );

        console.log(
            "✓ Active reconciliation lock prevents double claiming"
        );

        await Payment.updateOne(
            {
                _id:
                    locked.payment._id
            },
            {
                $set: {
                    reconciliationLockUntil:
                        new Date(
                            Date.now() - 1000
                        )
                }
            }
        );

        const expiredClaim =
            await claimNextPayment();

        assert(
            expiredClaim &&
                String(
                    expiredClaim._id
                ) ===
                    String(
                        locked.payment._id
                    ),
            "Expired reconciliation lock was not reclaimed."
        );

        console.log(
            "✓ Expired reconciliation lock can be reclaimed"
        );

        /*
         * ============================================================
         * 6. CONCURRENT CLAIMING
         * ============================================================
         */

        const concurrent =
            await createTestPayment({
                suffix:
                    "CONCURRENT"
            });

        paymentIds.push(
            concurrent.payment._id
        );

        transactionIds.push(
            concurrent.transaction._id
        );

        await markForReconciliation(
            concurrent.payment
        );

        const concurrentClaims =
            await Promise.all([
                claimNextPayment(),
                claimNextPayment()
            ]);

        const matchingClaims =
            concurrentClaims.filter(
                payment =>
                    payment &&
                    String(
                        payment._id
                    ) ===
                        String(
                            concurrent.payment._id
                        )
            );

        assert(
            matchingClaims.length <= 1,
            `Concurrent claiming produced ${matchingClaims.length} claims for the same payment.`
        );

        console.log(
            "✓ Concurrent workers cannot claim the same payment twice"
        );

        console.log(
            "\n=============================================="
        );

        console.log(
            "PAYMENT RECONCILIATION TEST PASSED ✓"
        );

        console.log(
            "=============================================="
        );

        console.log({
            verifyCalls:
                providerState.verifyCalls,
            recoveryCalls:
                providerState.recoveryCalls,
            testedPayments:
                paymentIds.length
        });

    } catch (error) {
        console.error(
            "\nPAYMENT RECONCILIATION TEST FAILED:"
        );

        console.error(
            error.stack ||
                error.message
        );

        process.exitCode = 1;

    } finally {
        try {
            await WebhookDelivery.deleteMany({
                business:
                    businessId
            });
        } catch (error) {
            console.error(
                "Webhook cleanup warning:",
                error.message
            );
        }

        if (paymentIds.length) {
            await Payment.deleteMany({
                _id: {
                    $in:
                        paymentIds
                }
            });
        }

        if (transactionIds.length) {
            await Transaction.deleteMany({
                _id: {
                    $in:
                        transactionIds
                }
            });
        }

        await LedgerEntry.deleteMany({
            business:
                businessId,

            reference: {
                $regex:
                    `^LEDGER-(CREDIT|DEBIT-REFUND)-PP-RECON-${runId}-`
            }
        });

        await PlatformLedgerEntry.deleteMany({
            reference: {
                $regex:
                    `^(PRIMEPAY-FEE|PROVIDER-COST)-PP-RECON-${runId}-`
            }
        });

        await ProviderConfig.deleteOne({
            provider:
                TEST_PROVIDER
        });

        await FeeConfig.deleteOne({
            provider:
                TEST_PROVIDER,

            currency: "KES"
        });

        await mongoose.disconnect();

        console.log(
            "Test data cleaned up."
        );
    }
}

run();
