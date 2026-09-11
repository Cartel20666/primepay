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
    "primepay-completion-test";

const businessId =
    new mongoose.Types.ObjectId(
        "6aa05c5f113e60632a0eea86"
    );

const testReference =
    `PP-COMPLETION-${Date.now()}`;

const idempotencyKey =
    `completion-${Date.now()}`;

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
                `COMPLETION-TXN-${Date.now()}`,
            providerReference:
                `COMPLETION-REF-${reference}`,
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
                    "payment-completion"
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
    let payment = null;
    let transaction = null;

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
            "Temporary completion-test provider activated."
        );

        const created =
            await createPayment({
                businessId,
                reference: testReference,
                idempotencyKey,
                amount: 100,
                currency: "KES",
                country: "KE",
                provider: TEST_PROVIDER,
                customerName:
                    "Completion Test",
                customerEmail:
                    "completion@test.local",
                description:
                    "PrimePay payment completion integration test"
            });

        payment = created.payment;
        transaction = created.transaction;

        console.log(
            "\nINITIAL PAYMENT:"
        );

        console.log({
            status:
                payment.status,
            transactionStatus:
                transaction.status,
            fee:
                payment.fee,
            netAmount:
                payment.netAmount
        });

        if (
            payment.status !== "processing" ||
            transaction.status !== "processing"
        ) {
            throw new Error(
                "Initial payment was not created in processing state."
            );
        }

        const completed =
            await synchronizePaymentStatus({
                payment,
                providerResult: {
                    success: true,
                    provider:
                        TEST_PROVIDER,
                    status: "completed",
                    providerTransactionId:
                        payment.providerTransactionId,
                    providerReference:
                        payment.providerReference,
                    message:
                        "Payment completed"
                }
            });

        console.log(
            "\nCOMPLETION RESULT:"
        );

        console.log({
            paymentStatus:
                completed.payment.status,
            transactionStatus:
                completed.transaction.status,
            previousStatus:
                completed.previousStatus
        });

        if (
            completed.payment.status !==
                "completed" ||
            completed.transaction.status !==
                "completed"
        ) {
            throw new Error(
                "Payment did not transition to completed."
            );
        }

        const ledgerReference =
            `LEDGER-CREDIT-${testReference}`;

        const firstLedgerCount =
            await LedgerEntry.countDocuments({
                business: businessId,
                reference:
                    ledgerReference
            });

        console.log(
            "\nFIRST LEDGER VERIFICATION:"
        );

        console.log({
            ledgerEntries:
                firstLedgerCount
        });

        if (
            firstLedgerCount !== 1
        ) {
            throw new Error(
                "Expected exactly one ledger credit after completion."
            );
        }

        const repeatedCompletion =
            await synchronizePaymentStatus({
                payment:
                    completed.payment,
                providerResult: {
                    success: true,
                    provider:
                        TEST_PROVIDER,
                    status: "completed",
                    providerTransactionId:
                        payment.providerTransactionId,
                    providerReference:
                        payment.providerReference,
                    message:
                        "Repeated completion"
                }
            });

        const secondLedgerCount =
            await LedgerEntry.countDocuments({
                business: businessId,
                reference:
                    ledgerReference
            });

        console.log(
            "\nREPEATED COMPLETION:"
        );

        console.log({
            paymentStatus:
                repeatedCompletion.payment.status,
            transactionStatus:
                repeatedCompletion.transaction.status,
            ledgerEntries:
                secondLedgerCount
        });

        if (
            repeatedCompletion.payment.status !==
                "completed" ||
            repeatedCompletion.transaction.status !==
                "completed" ||
            secondLedgerCount !== 1
        ) {
            throw new Error(
                "Repeated completion changed the payment state or created a duplicate ledger credit."
            );
        }

        let downgradeRejected = false;

        try {
            await synchronizePaymentStatus({
                payment:
                    repeatedCompletion.payment,
                providerResult: {
                    success: true,
                    provider:
                        TEST_PROVIDER,
                    status: "processing",
                    message:
                        "Late processing status"
                }
            });
        } catch (error) {
            downgradeRejected =
                error.message ===
                'Illegal payment status transition: "completed" -> "processing".';

            console.log(
                "\nDOWNGRADE PROTECTION:"
            );

            console.log({
                rejected:
                    downgradeRejected,
                message:
                    error.message
            });
        }

        const finalPayment =
            await Payment.findById(
                payment._id
            );

        const finalTransaction =
            await Transaction.findById(
                transaction._id
            );

        const finalLedgerCount =
            await LedgerEntry.countDocuments({
                business: businessId,
                reference:
                    ledgerReference
            });

        console.log(
            "\nFINAL DATABASE VERIFICATION:"
        );

        console.log({
            paymentStatus:
                finalPayment?.status,
            transactionStatus:
                finalTransaction?.status,
            ledgerEntries:
                finalLedgerCount
        });

        if (
            !downgradeRejected ||
            finalPayment?.status !==
                "completed" ||
            finalTransaction?.status !==
                "completed" ||
            finalLedgerCount !== 1
        ) {
            throw new Error(
                "Payment completion integrity test failed."
            );
        }

        console.log(
            "\nPAYMENT COMPLETION TEST PASSED."
        );
    } catch (error) {
        console.error(
            "\nPAYMENT COMPLETION TEST FAILED:"
        );

        console.error(
            error.message
        );

        process.exitCode = 1;
    } finally {
        try {
            await LedgerEntry.deleteMany({
                business: businessId,
                reference:
                    `LEDGER-CREDIT-${testReference}`
            });

            if (payment?._id) {
                await Payment.deleteOne({
                    _id: payment._id
                });
            }

            if (transaction?._id) {
                await Transaction.deleteOne({
                    _id: transaction._id
                });
            }

            await ProviderConfig.deleteOne({
                provider: TEST_PROVIDER
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
