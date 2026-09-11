require("dotenv").config();

const mongoose = require("mongoose");

const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");
const ProviderConfig = require("./src/models/ProviderConfig");

const {
    registerProvider
} = require("./src/providers/provider.registry");

const {
    createPayment
} = require("./src/services/payment.service");

const TEST_PROVIDER = "primepay-test";
const IDEMPOTENCY_KEY = `idempotency-test-${Date.now()}`;

const businessId =
    new mongoose.Types.ObjectId("6aa05c5f113e60632a0eea86");

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
                `TEST-TXN-${Date.now()}`,
            providerReference:
                `TEST-REF-${reference}`,
            status: "processing",
            fee: 0,
            netAmount: amount,
            settlementCurrency: currency,
            exchangeRate: 1,
            metadata: {
                test: true
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
            "Temporary provider activated."
        );

        const first =
            await createPayment({
                businessId,
                reference:
                    `PP-TEST-${Date.now()}-1`,
                idempotencyKey:
                    IDEMPOTENCY_KEY,
                amount: 100,
                currency: "KES",
                country: "KE",
                provider: TEST_PROVIDER,
                customerName:
                    "Idempotency Test",
                customerEmail:
                    "idempotency@test.local",
                description:
                    "PrimePay idempotency integration test"
            });

        console.log("\nFIRST REQUEST:");
        console.log({
            idempotentReplay:
                first.idempotentReplay,
            paymentId:
                first.payment?._id?.toString(),
            transactionId:
                first.transaction?._id?.toString(),
            reference:
                first.payment?.reference
        });

        const second =
            await createPayment({
                businessId,
                reference:
                    `PP-TEST-${Date.now()}-2`,
                idempotencyKey:
                    IDEMPOTENCY_KEY,
                amount: 100,
                currency: "KES",
                country: "KE",
                provider: TEST_PROVIDER,
                customerName:
                    "Idempotency Test",
                customerEmail:
                    "idempotency@test.local",
                description:
                    "PrimePay idempotency integration test"
            });

        console.log("\nSECOND REQUEST:");
        console.log({
            idempotentReplay:
                second.idempotentReplay,
            paymentId:
                second.payment?._id?.toString(),
            transactionId:
                second.transaction?._id?.toString(),
            reference:
                second.payment?.reference
        });

        let conflictDetected = false;

        try {
            await createPayment({
                businessId,
                reference:
                    `PP-TEST-${Date.now()}-3`,
                idempotencyKey:
                    IDEMPOTENCY_KEY,
                amount: 500,
                currency: "KES",
                country: "KE",
                provider: TEST_PROVIDER,
                customerName:
                    "Idempotency Test",
                customerEmail:
                    "idempotency@test.local",
                description:
                    "PrimePay idempotency integration test"
            });
        } catch (error) {
            conflictDetected =
                error.message ===
                "Idempotency-Key has already been used for a different payment request.";

            console.log("\nCONFLICT TEST:");
            console.log({
                detected: conflictDetected,
                message: error.message
            });
        }

        const payments =
            await Payment.find({
                business: businessId,
                idempotencyKey:
                    IDEMPOTENCY_KEY
            });

        const transactions =
            await Transaction.find({
                business: businessId,
                reference: first.payment.reference
            });

        console.log("\nDATABASE VERIFICATION:");
        console.log({
            paymentsWithSameIdempotencyKey:
                payments.length,
            transactionForFirstPayment:
                transactions.length
        });

        if (
            first.idempotentReplay !== false ||
            second.idempotentReplay !== true ||
            payments.length !== 1 ||
            first.payment._id.toString() !==
                second.payment._id.toString() ||
            !conflictDetected
        ) {
            throw new Error(
                "IDEMPOTENCY TEST FAILED."
            );
        }

        console.log(
            "\nIDEMPOTENCY TEST PASSED."
        );
    } catch (error) {
        console.error(
            "\nIDEMPOTENCY TEST FAILED:"
        );
        console.error(
            error.message
        );

        process.exitCode = 1;
    } finally {
        try {
            await Payment.deleteMany({
                business: businessId,
                idempotencyKey:
                    IDEMPOTENCY_KEY
            });

            await Transaction.deleteMany({
                business: businessId,
                metadata: {
                    test: true
                }
            });

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
