require("dotenv").config();

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");

const app = require("./src/app");
const User = require("./src/models/User");
const Business = require("./src/models/Business");
const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");
const ProviderWebhookEvent = require("./src/models/ProviderWebhookEvent");

const mpesaProvider =
    require("./src/providers/mpesa/mpesa.provider");

const PORT = 5098;
let server;

const originalVerifyPayment =
    mpesaProvider.verifyPayment;

const originalInitiatePayment =
    mpesaProvider.initiatePayment;

const httpRequest = async ({
    method,
    path,
    body
}) => {
    const response = await fetch(
        `http://127.0.0.1:${PORT}${path}`,
        {
            method,
            headers: {
                "Content-Type":
                    "application/json"
            },
            body: body
                ? JSON.stringify(body)
                : undefined
        }
    );

    const text =
        await response.text();

    let data = null;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    return {
        status: response.status,
        data
    };
};

const cleanup = async ({
    userId,
    businessId,
    paymentIds
}) => {
    await ProviderWebhookEvent.deleteMany({
        provider: "mpesa"
    });

    await Payment.deleteMany({
        _id: {
            $in: paymentIds
        }
    });

    await Transaction.deleteMany({
        business: businessId
    });

    await Business.deleteOne({
        _id: businessId
    });

    await User.deleteOne({
        _id: userId
    });
};

const run = async () => {
    await mongoose.connect(
        process.env.MONGODB_URI
    );

    const unique =
        crypto.randomBytes(8).toString("hex");

    const user =
        await User.create({
            name:
                `M-Pesa Webhook Test ${unique}`,
            email:
                `mpesa-webhook-${unique}@test.com`,
            password:
                "TestPassword123!",
            role: "merchant",
            emailVerified: true,
            status: "active"
        });

    const business =
        await Business.create({
            owner: user._id,
            businessName:
                `M-Pesa Webhook Test ${unique}`,
            businessType: "sole_proprietorship",
            country: "KE",
            currency: "KES",
            verificationStatus: "approved",
            liveApiEnabled: false,
            suspended: false
        });

    const paymentReference =
        `PP-MPESA-${unique}`;

    const providerReference =
        `ws_CO_${unique}`;

    const transaction =
        await Transaction.create({
            business: business._id,
            reference:
                `TX-MPESA-${unique}`,
            type: "payment",
            amount: 1500,
            currency: "KES",
            provider: "mpesa",
            providerReference,
            status: "processing"
        });

    const payment =
        await Payment.create({
            business: business._id,
            transaction: transaction._id,
            reference: paymentReference,
            idempotencyKey:
                `mpesa-webhook-${unique}`,
            requestFingerprint:
                crypto
                    .createHash("sha256")
                    .update(unique)
                    .digest("hex"),
            amount: 1500,
            currency: "KES",
            country: "KE",
            paymentMethod: "mobile_money",
            provider: "mpesa",
            providerReference,
            providerTransactionId:
                providerReference,
            checkoutRequestId:
                providerReference,
            status: "processing",
            reconciliationStatus:
                "not_required"
        });

    const paymentIds = [
        payment._id
    ];

    let verificationCalls = 0;

    /*
     * Deliberately return "processing".
     *
     * This simulates Daraja refusing to confirm
     * completion. The callback will claim ResultCode 0,
     * but PrimePay must NOT trust it.
     */
    mpesaProvider.verifyPayment =
        async checkoutRequestId => {
            verificationCalls++;

            assert.strictEqual(
                checkoutRequestId,
                payment.checkoutRequestId
            );

            return {
                success: false,
                provider: "mpesa",
                status: "processing",
                message:
                    "Payment verification pending.",
                providerReference:
                    checkoutRequestId,
                providerTransactionId:
                    checkoutRequestId,
                providerResponse: {
                    ResultCode: 1037,
                    ResultDesc:
                        "Timeout"
                }
            };
        };

    server =
        app.listen(
            PORT,
            async () => {
                try {
                    const response =
                        await httpRequest({
                            method: "POST",
                            path:
                                "/api/v1/provider-webhooks/mpesa",
                            body: {
                                Body: {
                                    stkCallback: {
                                        MerchantRequestID:
                                            `MR_${unique}`,
                                        CheckoutRequestID:
                                            payment.checkoutRequestId,

                                        /*
                                         * This is the forged
                                         * success signal.
                                         */
                                        ResultCode: 0,
                                        ResultDesc:
                                            "The service request is processed successfully.",

                                        CallbackMetadata: {
                                            Item: [
                                                {
                                                    Name:
                                                        "Amount",
                                                    Value: 1500
                                                }
                                            ]
                                        }
                                    }
                                }
                            }
                        });

                    assert.strictEqual(
                        response.status,
                        200
                    );

                    const updated =
                        await Payment.findById(
                            payment._id
                        );

                    /*
                     * The critical security assertion:
                     *
                     * Callback says completed.
                     * Provider verification says processing.
                     * Therefore PrimePay must remain processing.
                     */
                    assert.strictEqual(
                        updated.status,
                        "processing"
                    );

                    assert.strictEqual(
                        verificationCalls,
                        1
                    );

                    const event =
                        await ProviderWebhookEvent
                            .findOne({
                                provider:
                                    "mpesa",
                                eventId:
                                    payment.checkoutRequestId
                            });

                    assert.ok(event);
                    assert.strictEqual(
                        event.status,
                        "processed"
                    );

                    console.log(
                        "✓ Forged M-Pesa success callback cannot complete payment"
                    );

                    console.log(
                        "✓ M-Pesa callback triggers server-side provider verification"
                    );

                    console.log(
                        "✓ Provider verification result overrides callback ResultCode"
                    );

                    console.log(
                        "✓ M-Pesa webhook event is recorded"
                    );

                    console.log(
                        "M-PESA PROVIDER WEBHOOK SECURITY TEST PASSED ✓"
                    );

                    await cleanup({
                        userId: user._id,
                        businessId:
                            business._id,
                        paymentIds
                    });

                    mpesaProvider.verifyPayment =
                        originalVerifyPayment;

                    mpesaProvider.initiatePayment =
                        originalInitiatePayment;

                    server.close(
                        async () => {
                            await mongoose.disconnect();
                        }
                    );
                } catch (error) {
                    console.error(
                        "M-PESA PROVIDER WEBHOOK SECURITY TEST FAILED:",
                        error
                    );

                    mpesaProvider.verifyPayment =
                        originalVerifyPayment;

                    mpesaProvider.initiatePayment =
                        originalInitiatePayment;

                    try {
                        await cleanup({
                            userId: user._id,
                            businessId:
                                business._id,
                            paymentIds
                        });
                    } catch {}

                    server.close(
                        async () => {
                            await mongoose.disconnect();
                            process.exit(1);
                        }
                    );
                }
            }
        );
};

run().catch(async error => {
    console.error(error);

    mpesaProvider.verifyPayment =
        originalVerifyPayment;

    mpesaProvider.initiatePayment =
        originalInitiatePayment;

    if (mongoose.connection.readyState) {
        await mongoose.disconnect();
    }

    process.exit(1);
});
