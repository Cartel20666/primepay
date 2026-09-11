require("dotenv").config();

const {
    verifyWebhookSignature
} = require("./src/providers/paypal/paypal.webhook");

function assert(condition, message) {
    if (!condition) {
        throw new Error(`ASSERTION FAILED: ${message}`);
    }
}

const validHeaders = {
    "paypal-transmission-id": "test-transmission-id",
    "paypal-transmission-time": "2026-09-10T10:00:00Z",
    "paypal-cert-url": "https://api.sandbox.paypal.com/certs/test.pem",
    "paypal-transmission-sig": "test-signature",
    "paypal-auth-algo": "SHA256withRSA"
};

const webhookEvent = {
    id: "WH-TEST-001",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
        id: "CAPTURE-TEST-001"
    }
};

async function expectRejected(label, fn) {
    try {
        await fn();

        throw new Error(
            `${label}: expected rejection but verification continued.`
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

async function main() {
    /*
     * Keep real credentials untouched.
     * We deliberately remove them for validation tests.
     */
    const originalClientId =
        process.env.PAYPAL_CLIENT_ID;

    const originalClientSecret =
        process.env.PAYPAL_CLIENT_SECRET;

    const originalWebhookId =
        process.env.PAYPAL_WEBHOOK_ID;

    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_WEBHOOK_ID;

    await expectRejected(
        "Missing PayPal webhook ID",
        () =>
            verifyWebhookSignature({
                headers: validHeaders,
                webhookEvent
            })
    );

    process.env.PAYPAL_WEBHOOK_ID =
        "test-webhook-id";

    await expectRejected(
        "Missing PayPal client credentials",
        () =>
            verifyWebhookSignature({
                headers: validHeaders,
                webhookEvent
            })
    );

    process.env.PAYPAL_CLIENT_ID =
        "test-client-id";

    await expectRejected(
        "Missing PayPal client secret",
        () =>
            verifyWebhookSignature({
                headers: validHeaders,
                webhookEvent
            })
    );

    process.env.PAYPAL_CLIENT_SECRET =
        "test-client-secret";

    const requiredHeaders = [
        "paypal-transmission-id",
        "paypal-transmission-time",
        "paypal-cert-url",
        "paypal-transmission-sig",
        "paypal-auth-algo"
    ];

    for (const header of requiredHeaders) {
        const headers = {
            ...validHeaders
        };

        delete headers[header];

        await expectRejected(
            `Missing ${header}`,
            () =>
                verifyWebhookSignature({
                    headers,
                    webhookEvent
                })
        );
    }

    await expectRejected(
        "Missing headers object",
        () =>
            verifyWebhookSignature({
                headers: null,
                webhookEvent
            })
    );

    await expectRejected(
        "Missing webhook event",
        () =>
            verifyWebhookSignature({
                headers: validHeaders,
                webhookEvent: null
            })
    );

    /*
     * Restore the user's real environment exactly as it was.
     */
    if (originalClientId === undefined) {
        delete process.env.PAYPAL_CLIENT_ID;
    } else {
        process.env.PAYPAL_CLIENT_ID =
            originalClientId;
    }

    if (originalClientSecret === undefined) {
        delete process.env.PAYPAL_CLIENT_SECRET;
    } else {
        process.env.PAYPAL_CLIENT_SECRET =
            originalClientSecret;
    }

    if (originalWebhookId === undefined) {
        delete process.env.PAYPAL_WEBHOOK_ID;
    } else {
        process.env.PAYPAL_WEBHOOK_ID =
            originalWebhookId;
    }

    console.log(
        "\nPAYPAL WEBHOOK VALIDATION TEST PASSED."
    );
}

main().catch(error => {
    console.error(
        "\nPAYPAL WEBHOOK VALIDATION TEST FAILED."
    );

    console.error(error);

    process.exit(1);
});
