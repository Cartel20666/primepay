require("dotenv").config();

const mongoose = require("mongoose");

const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");
const ProviderWebhookEvent = require("./src/models/ProviderWebhookEvent");
const Business = require("./src/models/Business");

const {
    synchronizePaymentStatus
} = require("./src/services/paymentStatus.service");

const BUSINESS_ID = "6aa05c5f113e60632a0eea86";

const TEST_PROVIDER = "primepay-webhook-test";

function assert(condition, message) {
    if (!condition) {
        throw new Error(`ASSERTION FAILED: ${message}`);
    }
}

async function cleanup() {
    await Payment.deleteMany({
        business: BUSINESS_ID,
        provider: TEST_PROVIDER
    });

    await Transaction.deleteMany({
        business: BUSINESS_ID,
        provider: TEST_PROVIDER
    });

    await ProviderWebhookEvent.deleteMany({
        provider: TEST_PROVIDER
    });
}

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected.");

    const business = await Business.findById(BUSINESS_ID);

    assert(business, "Test business exists.");

    await cleanup();

    const reference = `WH-TEST-${Date.now()}`;

    const transaction = await Transaction.create({
        business: BUSINESS_ID,
        type: "payment",
        reference,
        provider: TEST_PROVIDER,
        amount: 1000,
        currency: "KES",
        status: "processing",
        paymentMethod: "mobile_money"
    });

    const payment = await Payment.create({
        business: BUSINESS_ID,
        transaction: transaction._id,
        reference,
        idempotencyKey: `IDEMP-${Date.now()}`,
        requestFingerprint: `fingerprint-${Date.now()}`,
        amount: 1000,
        currency: "KES",
        provider: TEST_PROVIDER,
        paymentMethod: "mobile_money",
        status: "processing"
    });

    console.log("Test payment created.");

    const eventId = `evt-test-${Date.now()}`;

    const event = await ProviderWebhookEvent.create({
        provider: TEST_PROVIDER,
        eventId,
        eventType: "payment.completed",
        paymentReference: reference,
        providerReference: "PROVIDER-TEST-001",
        status: "received",
        payload: {
            test: true,
            eventId
        }
    });

    console.log("PASS: Webhook event recorded.");

    const providerResult = {
        status: "completed",
        providerReference: "PROVIDER-TEST-001",
        providerTransactionId: "PROVIDER-TXN-001",
        metadata: {
            webhookEventId: eventId,
            source: "integrity-test"
        }
    };

    const firstResult = await synchronizePaymentStatus({
        payment,
        providerResult
    });

    assert(firstResult.payment.status === "completed",
        "First webhook completes payment.");

    const refreshedPayment = await Payment.findById(payment._id);

    const refreshedTransaction =
        await Transaction.findById(transaction._id);

    assert(refreshedPayment.status === "completed",
        "Payment is completed in database.");

    assert(refreshedTransaction.status === "completed",
        "Transaction is completed in database.");

    console.log("PASS: Webhook completion -> completed.");

    const duplicateEvent = await ProviderWebhookEvent.findOne({
        provider: TEST_PROVIDER,
        eventId
    });

    assert(duplicateEvent,
        "Duplicate event can be detected.");

    console.log("PASS: Duplicate webhook event detected.");

    let duplicateRejected = false;

    try {
        await ProviderWebhookEvent.create({
            provider: TEST_PROVIDER,
            eventId,
            eventType: "payment.completed",
            paymentReference: reference,
            providerReference: "PROVIDER-TEST-001",
            status: "received",
            payload: {
                duplicate: true
            }
        });
    } catch (error) {
        duplicateRejected = error && error.code === 11000;
    }

    assert(duplicateRejected,
        "MongoDB unique index rejects duplicate provider event.");

    console.log("PASS: Duplicate event insertion rejected.");

    const completedLedgerEntries =
        await mongoose.connection.db.collection("ledgerentries")
            .countDocuments({
                business: new mongoose.Types.ObjectId(BUSINESS_ID),
                transaction: transaction._id,
                type: "credit"
            });

    assert(completedLedgerEntries === 1,
        "Exactly one ledger credit exists.");

    console.log(
        "PASS: Exactly one ledger credit:",
        completedLedgerEntries
    );

    let illegalTransitionRejected = false;

    try {
        await synchronizePaymentStatus({
            payment: refreshedPayment,
            providerResult: {
                status: "processing",
                providerReference: "PROVIDER-TEST-001"
            }
        });
    } catch (error) {
        illegalTransitionRejected = true;
        console.log(
            "Expected rejection:",
            error.message
        );
    }

    assert(illegalTransitionRejected,
        "Completed payment cannot be moved back to processing.");

    console.log(
        "PASS: Completed -> processing webhook rejected."
    );

    const finalPayment = await Payment.findById(payment._id);
    const finalTransaction =
        await Transaction.findById(transaction._id);

    assert(finalPayment.status === "completed",
        "Payment remains completed after illegal webhook.");

    assert(finalTransaction.status === "completed",
        "Transaction remains completed after illegal webhook.");

    console.log("\nFINAL DATABASE VERIFICATION:");
    console.log({
        paymentStatus: finalPayment.status,
        transactionStatus: finalTransaction.status,
        ledgerEntries: completedLedgerEntries,
        duplicateEventRejected: duplicateRejected
    });

    console.log("\nWEBHOOK INTEGRITY TEST PASSED.");

    await cleanup();
    await mongoose.disconnect();

    console.log("Test data cleaned up.");
}

main().catch(async (error) => {
    console.error("\nWEBHOOK INTEGRITY TEST FAILED.");
    console.error(error);

    try {
        await cleanup();
        await mongoose.disconnect();
    } catch {}

    process.exit(1);
});
