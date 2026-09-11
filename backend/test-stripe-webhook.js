require("dotenv").config();

const crypto = require("crypto");
const Stripe = require("stripe");

const TEST_SECRET =
    "whsec_primepay_test_secret_123456789";

const payload = JSON.stringify({
    id: "evt_primepay_test_001",
    object: "event",
    type: "payment_intent.succeeded",
    data: {
        object: {
            id: "pi_primepay_test_001",
            object: "payment_intent",
            amount: 1000,
            currency: "kes",
            status: "succeeded"
        }
    }
});

function assert(condition, message) {
    if (!condition) {
        throw new Error(`ASSERTION FAILED: ${message}`);
    }
}

function createStripeSignature(body, secret, timestamp) {
    const signedPayload = `${timestamp}.${body}`;

    const signature = crypto
        .createHmac("sha256", secret)
        .update(signedPayload, "utf8")
        .digest("hex");

    return `t=${timestamp},v1=${signature}`;
}

function expectRejected(label, fn) {
    try {
        fn();

        throw new Error(
            `${label}: expected rejection but verification succeeded.`
        );
    } catch (error) {
        if (
            error.message.startsWith(
                `${label}: expected rejection`
            )
        ) {
            throw error;
        }

        console.log(`PASS: ${label} -> rejected`);
    }
}

function main() {
    /*
     * Use the Stripe SDK directly for this isolated cryptographic test.
     * No STRIPE_SECRET_KEY is required because constructEvent only
     * needs the webhook signing secret.
     */
    const stripe = new Stripe("sk_test_primepay_local_test_key");

    const timestamp =
        Math.floor(Date.now() / 1000);

    const validSignature =
        createStripeSignature(
            payload,
            TEST_SECRET,
            timestamp
        );

    const validEvent =
        stripe.webhooks.constructEvent(
            payload,
            validSignature,
            TEST_SECRET
        );

    assert(
        validEvent.id === "evt_primepay_test_001",
        "Valid signature returns expected event."
    );

    assert(
        validEvent.type === "payment_intent.succeeded",
        "Valid event type is preserved."
    );

    console.log(
        "PASS: Valid Stripe signature accepted."
    );

    const tamperedPayload =
        JSON.stringify({
            id: "evt_primepay_test_001",
            object: "event",
            type: "payment_intent.succeeded",
            data: {
                object: {
                    id: "pi_primepay_test_001",
                    amount: 999999,
                    currency: "kes",
                    status: "succeeded"
                }
            }
        });

    expectRejected(
        "Tampered payload",
        () =>
            stripe.webhooks.constructEvent(
                tamperedPayload,
                validSignature,
                TEST_SECRET
            )
    );

    expectRejected(
        "Invalid signature",
        () =>
            stripe.webhooks.constructEvent(
                payload,
                `t=${timestamp},v1=invalid_signature`,
                TEST_SECRET
            )
    );

    expectRejected(
        "Missing signature",
        () =>
            stripe.webhooks.constructEvent(
                payload,
                null,
                TEST_SECRET
            )
    );

    expectRejected(
        "Wrong webhook secret",
        () =>
            stripe.webhooks.constructEvent(
                payload,
                validSignature,
                "whsec_wrong_secret"
            )
    );

    console.log(
        "\nSTRIPE WEBHOOK SIGNATURE TEST PASSED."
    );
}

try {
    main();
} catch (error) {
    console.error(
        "\nSTRIPE WEBHOOK SIGNATURE TEST FAILED."
    );

    console.error(error);

    process.exit(1);
}
