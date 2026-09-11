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
const TEST_PROVIDER = "primepay-webhook-race";

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

    const timestamp = Date.now();
    const reference = `RACE-TEST-${timestamp}`;
    const eventId = `evt-race-${timestamp}`;

    const transaction = await Transaction.create({
        business: BUSINESS_ID,
        type: "payment",
        reference,
        provider: TEST_PROVIDER,
        amount: 1500,
        currency: "KES",
        status: "processing",
        paymentMethod: "mobile_money"
    });

    const payment = await Payment.create({
        business: BUSINESS_ID,
        transaction: transaction._id,
        reference,
        idempotencyKey: `IDEMP-RACE-${timestamp}`,
        requestFingerprint: `fingerprint-race-${timestamp}`,
        amount: 1500,
        currency: "KES",
        provider: TEST_PROVIDER,
        paymentMethod: "mobile_money",
        status: "processing"
    });

    console.log("Test payment created.");

    /*
     * Simulate two provider callbacks arriving concurrently.
     *
     * Promise.all() deliberately starts both database operations
     * without waiting for the first one to finish.
     */

    const eventDocument = {
        provider: TEST_PROVIDER,
        eventId,
        eventType: "payment.completed",
        paymentReference: reference,
        providerReference: "RACE-PROVIDER-001",
        status: "received",
        payload: {
            eventId,
            simulated: true
        }
    };

    console.log("Sending two identical webhook events concurrently...");

    const results = await Promise.allSettled([
        ProviderWebhookEvent.create(eventDocument),
        ProviderWebhookEvent.create(eventDocument)
    ]);

    const fulfilled = results.filter(
        result => result.status === "fulfilled"
    );

    const rejected = results.filter(
        result => result.status === "rejected"
    );

    console.log({
        successfulInserts: fulfilled.length,
        rejectedInserts: rejected.length
    });

    assert(
        fulfilled.length === 1,
        "Exactly one concurrent webhook event insertion succeeds."
    );

    assert(
        rejected.length === 1,
        "Exactly one concurrent webhook event insertion is rejected."
    );

    assert(
        rejected[0].reason &&
        rejected[0].reason.code === 11000,
        "The rejected duplicate is a MongoDB duplicate-key rejection."
    );

    console.log(
        "PASS: Concurrent duplicate insertion protected by unique index."
    );

    const eventCount = await ProviderWebhookEvent.countDocuments({
        provider: TEST_PROVIDER,
        eventId
    });

    assert(
        eventCount === 1,
        "Database contains exactly one webhook event."
    );

    console.log(
        "PASS: Exactly one webhook event exists in database."
    );

    const providerResult = {
        status: "completed",
        providerReference: "RACE-PROVIDER-001",
        providerTransactionId: "RACE-TXN-001",
        metadata: {
            webhookEventId: eventId,
            source: "race-test"
        }
    };

    /*
     * Both callbacks now attempt to complete the same payment.
     * The payment state machine and ledger idempotency must protect
     * the financial result.
     */

    console.log("Sending two concurrent completion attempts...");

    const completionResults = await Promise.allSettled([
        synchronizePaymentStatus({
            payment,
            providerResult
        }),
        synchronizePaymentStatus({
            payment,
            providerResult
        })
    ]);

    const successfulCompletions =
        completionResults.filter(
            result => result.status === "fulfilled"
        );

    const failedCompletions =
        completionResults.filter(
            result => result.status === "rejected"
        );

    console.log({
        successfulCompletions: successfulCompletions.length,
        rejectedCompletions: failedCompletions.length
    });

    /*
     * At least one completion must succeed.
     * A second concurrent completion may either succeed harmlessly
     * or be rejected by the state machine. What matters financially
     * is that the final state and ledger remain correct.
     */

    assert(
        successfulCompletions.length >= 1,
        "At least one concurrent completion succeeds."
    );

    console.log(
        "PASS: Concurrent completion attempts did not prevent completion."
    );

    const finalPayment = await Payment.findById(payment._id);
    const finalTransaction = await Transaction.findById(transaction._id);

    assert(
        finalPayment.status === "completed",
        "Payment ends completed."
    );

    assert(
        finalTransaction.status === "completed",
        "Transaction ends completed."
    );

    const ledgerCount =
        await mongoose.connection.db
            .collection("ledgerentries")
            .countDocuments({
                business: new mongoose.Types.ObjectId(BUSINESS_ID),
                transaction: transaction._id,
                type: "credit"
            });

    assert(
        ledgerCount === 1,
        "Exactly one ledger credit exists."
    );

    console.log(
        "PASS: Exactly one ledger credit after concurrent completion."
    );

    const finalEventCount =
        await ProviderWebhookEvent.countDocuments({
            provider: TEST_PROVIDER,
            eventId
        });

    assert(
        finalEventCount === 1,
        "Exactly one provider webhook event remains."
    );

    console.log(
        "PASS: Exactly one provider webhook event remains."
    );

    console.log("\nFINAL DATABASE VERIFICATION:");
    console.log({
        webhookEvents: finalEventCount,
        paymentStatus: finalPayment.status,
        transactionStatus: finalTransaction.status,
        ledgerEntries: ledgerCount
    });

    console.log("\nWEBHOOK RACE TEST PASSED.");

    await cleanup();
    await mongoose.disconnect();

    console.log("Test data cleaned up.");
}

main().catch(async error => {
    console.error("\nWEBHOOK RACE TEST FAILED.");
    console.error(error);

    try {
        await cleanup();
        await mongoose.disconnect();
    } catch {}

    process.exit(1);
});
