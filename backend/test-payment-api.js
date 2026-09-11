require("dotenv").config();

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const app = require("./src/app");

const User = require("./src/models/User");
const Business = require("./src/models/Business");
const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");
const ProviderConfig = require("./src/models/ProviderConfig");

const mpesaProvider =
    require("./src/providers/mpesa/mpesa.provider");

const originalInitiatePayment =
    mpesaProvider.initiatePayment;

const originalVerifyPayment =
    mpesaProvider.verifyPayment;

let server;

const test = async (name, fn) => {
    try {
        await fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        throw error;
    }
};

const httpRequest = async ({
    method,
    path,
    token,
    idempotencyKey,
    body
}) => {
    const headers = {
        "Content-Type": "application/json"
    };

    if (token) {
        headers.Authorization =
            `Bearer ${token}`;
    }

    if (idempotencyKey) {
        headers["Idempotency-Key"] =
            idempotencyKey;
    }

    const response =
        await fetch(
            `http://127.0.0.1:${process.env.TEST_PORT || 5099}${path}`,
            {
                method,
                headers,
                body:
                    body !== undefined
                        ? JSON.stringify(body)
                        : undefined
            }
        );

    let data = null;

    try {
        data = await response.json();
    } catch (_) {}

    return {
        status: response.status,
        data
    };
};

const run = async () => {
    assert(
        process.env.MONGODB_URI,
        "MONGODB_URI must be configured."
    );

    assert(
        process.env.JWT_SECRET,
        "JWT_SECRET must be configured."
    );

    await mongoose.connect(
        process.env.MONGODB_URI
    );

    console.log(
        "PrimePay test database connected."
    );

    /*
     * We need M-Pesa active for the service layer,
     * but no real provider request should happen.
     *
     * The provider activation check reads ProviderConfig,
     * so we inspect the existing configuration rather
     * than inventing production configuration here.
     */

    const suffix =
        `${Date.now()}-${crypto
            .randomBytes(4)
            .toString("hex")}`;

    const user =
        await User.create({
            name:
                `Payment API Test User ${suffix}`,
            email:
                `payment-api-${suffix}@example.com`,
            password:
                "PaymentApiTestPassword123!",
            role: "merchant",
            emailVerified: true,
            status: "active"
        });

    /*
     * Create a temporary validated + active M-Pesa configuration.
     * The real provider credentials are never changed.
     */
    const existingProviderConfig =
        await ProviderConfig.findOne({
            provider: "mpesa"
        }).select("+credentialFingerprint");

    const originalProviderConfig =
        existingProviderConfig
            ? existingProviderConfig.toObject()
            : null;

    await ProviderConfig.findOneAndUpdate(
        {
            provider: "mpesa"
        },
        {
            provider: "mpesa",
            environment: "sandbox",
            configured: true,
            validated: true,
            active: true,
            capabilities: {
                payments: true,
                cardPayments: false,
                bankPayments: false,
                mobileMoney: true,
                verification: true,
                refunds: false,
                payouts: false,
                webhooks: true,
                subscriptions: false,
                recovery: false
            },
            metadata: {
                testFixture: true
            }
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    );

    const business =
        await Business.create({
            owner: user._id,
            businessName:
                `Payment API Test Business ${suffix}`,
            businessType:
                "sole_proprietorship",
            country: "Kenya",
            currency: "KES",
            verificationStatus: "approved",
            liveApiEnabled: false,
            suspended: false
        });

    const token =
        jwt.sign(
            {
                id: user._id.toString()
            },
            process.env.JWT_SECRET,
            {
                algorithm: "HS256",
                expiresIn: "15m"
            }
        );

    let initiateCalls = 0;
    let verifyCalls = 0;

    mpesaProvider.initiatePayment =
        async payment => {
            initiateCalls += 1;

            return {
                success: true,
                provider: "mpesa",
                status: "processing",
                paymentReference:
                    payment.reference,
                providerTransactionId:
                    `ws_CO_TEST_${initiateCalls}`,
                providerReference:
                    `ws_CO_TEST_${initiateCalls}`,
                checkoutRequestId:
                    `ws_CO_TEST_${initiateCalls}`,
                merchantRequestId:
                    `MR_TEST_${initiateCalls}`,
                providerResponse: {
                    test: true
                }
            };
        };

    mpesaProvider.verifyPayment =
        async providerReference => {
            verifyCalls += 1;

            return {
                success: true,
                provider: "mpesa",
                status: "processing",
                providerReference,
                providerTransactionId:
                    providerReference,
                providerResponse: {
                    test: true
                }
            };
        };

    const TEST_PORT =
        process.env.TEST_PORT || 5099;

    server =
        await new Promise(
            (resolve, reject) => {
                const instance =
                    app.listen(
                        TEST_PORT,
                        "127.0.0.1",
                        () => resolve(instance)
                    );

                instance.on(
                    "error",
                    reject
                );
            }
        );

    await test(
        "Missing JWT is rejected",
        async () => {
            const result =
                await httpRequest({
                    method: "POST",
                    path:
                        "/api/v1/payments",
                    idempotencyKey:
                        `missing-jwt-${suffix}`,
                    body: {
                        amount: 1500,
                        currency: "KES",
                        provider: "mpesa",
                        customerPhone:
                            "0712345678"
                    }
                });

            assert.strictEqual(
                result.status,
                401
            );
        }
    );

    await test(
        "Missing Idempotency-Key is rejected",
        async () => {
            const result =
                await httpRequest({
                    method: "POST",
                    path:
                        "/api/v1/payments",
                    token,
                    body: {
                        amount: 1500,
                        currency: "KES",
                        provider: "mpesa",
                        customerPhone:
                            "0712345678"
                    }
                });

            assert.strictEqual(
                result.status,
                400
            );

            assert(
                result.data.message.includes(
                    "Idempotency-Key"
                )
            );
        }
    );

    await test(
        "Invalid payment amount is rejected",
        async () => {
            const result =
                await httpRequest({
                    method: "POST",
                    path:
                        "/api/v1/payments",
                    token,
                    idempotencyKey:
                        `invalid-amount-${suffix}`,
                    body: {
                        amount: 0,
                        currency: "KES",
                        provider: "mpesa"
                    }
                });

            assert.strictEqual(
                result.status,
                400
            );
        }
    );

    await test(
        "Provider is required",
        async () => {
            const result =
                await httpRequest({
                    method: "POST",
                    path:
                        "/api/v1/payments",
                    token,
                    idempotencyKey:
                        `missing-provider-${suffix}`,
                    body: {
                        amount: 1500,
                        currency: "KES"
                    }
                });

            assert.strictEqual(
                result.status,
                400
            );
        }
    );

    const idempotencyKey =
        `payment-api-${suffix}`;

    const payload = {
        amount: 1500,
        currency: "KES",
        country: "ke",
        provider: "mpesa",
        paymentMethod: "mobile_money",
        customerName: "API Test Customer",
        customerEmail:
            "customer@example.com",
        customerPhone:
            "0712345678",
        description:
            "PrimePay API integration test",
        metadata: {
            orderId:
                `ORDER-${suffix}`
        }
    };

    let firstPayment;

    await test(
        "Valid payment request creates a payment",
        async () => {
            const result =
                await httpRequest({
                    method: "POST",
                    path:
                        "/api/v1/payments",
                    token,
                    idempotencyKey,
                    body: payload
                });

            assert.strictEqual(
                result.status,
                201
            );

            assert.strictEqual(
                result.data.success,
                true
            );

            assert.strictEqual(
                result.data.idempotentReplay,
                false
            );

            assert(
                result.data.payment
            );

            assert(
                result.data.transaction
            );

            assert.strictEqual(
                result.data.payment.amount,
                1500
            );

            assert.strictEqual(
                result.data.payment.currency,
                "KES"
            );

            assert.strictEqual(
                result.data.payment.provider,
                "mpesa"
            );

            assert.strictEqual(
                result.data.payment.status,
                "processing"
            );

            assert.strictEqual(
                result.data.transaction.status,
                "processing"
            );

            assert.strictEqual(
                result.data.provider.provider,
                "mpesa"
            );

            assert.strictEqual(
                initiateCalls,
                1
            );

            firstPayment =
                result.data.payment;
        }
    );

    await test(
        "Created payment exists in MongoDB",
        async () => {
            const payment =
                await Payment.findOne({
                    reference:
                        firstPayment.reference
                });

            assert(payment);

            assert.strictEqual(
                payment.business.toString(),
                business._id.toString()
            );

            assert.strictEqual(
                payment.status,
                "processing"
            );

            assert.strictEqual(
                payment.providerReference,
                firstPayment.providerReference
            );

            const transaction =
                await Transaction.findById(
                    payment.transaction
                );

            assert(transaction);

            assert.strictEqual(
                transaction.status,
                "processing"
            );

            assert.strictEqual(
                transaction.business.toString(),
                business._id.toString()
            );
        }
    );

    await test(
        "Same idempotency key replays the existing payment",
        async () => {
            const result =
                await httpRequest({
                    method: "POST",
                    path:
                        "/api/v1/payments",
                    token,
                    idempotencyKey,
                    body: payload
                });

            assert.strictEqual(
                result.status,
                200
            );

            assert.strictEqual(
                result.data.success,
                true
            );

            assert.strictEqual(
                result.data.idempotentReplay,
                true
            );

            assert.strictEqual(
                result.data.payment.reference,
                firstPayment.reference
            );

            assert.strictEqual(
                initiateCalls,
                1
            );

            const count =
                await Payment.countDocuments({
                    business:
                        business._id,
                    idempotencyKey
                });

            assert.strictEqual(
                count,
                1
            );
        }
    );

    await test(
        "Same idempotency key with different payload is rejected",
        async () => {
            const changedPayload = {
                ...payload,
                amount: 1600
            };

            const result =
                await httpRequest({
                    method: "POST",
                    path:
                        "/api/v1/payments",
                    token,
                    idempotencyKey,
                    body: changedPayload
                });

            assert.strictEqual(
                result.status,
                409
            );

            assert.strictEqual(
                result.data.success,
                false
            );

            assert.strictEqual(
                result.data.code,
                "IDEMPOTENCY_CONFLICT"
            );

            assert.strictEqual(
                initiateCalls,
                1
            );
        }
    );

    await test(
        "Payment status endpoint is business-scoped",
        async () => {
            const result =
                await httpRequest({
                    method: "GET",
                    path:
                        `/api/v1/payments/${firstPayment.reference}/status`,
                    token
                });

            assert.strictEqual(
                result.status,
                200
            );

            assert.strictEqual(
                result.data.success,
                true
            );

            assert.strictEqual(
                result.data.payment.reference,
                firstPayment.reference
            );

            assert.strictEqual(
                result.data.payment.status,
                "processing"
            );
        }
    );

    await test(
        "Concurrent identical idempotency requests create exactly one payment",
        async () => {
            const concurrentKey =
                `concurrent-${crypto.randomBytes(12).toString("hex")}`;

            const concurrentPayload = {
                ...payload,
                amount: 1750
            };

            const requests = Array.from(
                { length: 5 },
                () =>
                    httpRequest({
                        method: "POST",
                        path: "/api/v1/payments",
                        token,
                        idempotencyKey: concurrentKey,
                        body: concurrentPayload
                    })
            );

            const results =
                await Promise.all(requests);

            const successfulResults =
                results.filter(
                    result =>
                        result.status === 200 ||
                        result.status === 201
                );

            assert.strictEqual(
                successfulResults.length,
                5
            );

            const references =
                new Set(
                    successfulResults.map(
                        result =>
                            result.data.payment.reference
                    )
                );

            assert.strictEqual(
                references.size,
                1
            );

            const databaseCount =
                await Payment.countDocuments({
                    business: business._id,
                    idempotencyKey: concurrentKey
                });

            assert.strictEqual(
                databaseCount,
                1
            );

            assert.strictEqual(
                initiateCalls,
                2
            );
        }
    );

    await test(
        "Payment lookup endpoint returns the created payment",
        async () => {
            const result =
                await httpRequest({
                    method: "GET",
                    path:
                        `/api/v1/payments/${firstPayment.reference}`,
                    token
                });

            assert.strictEqual(
                result.status,
                200
            );

            assert.strictEqual(
                result.data.success,
                true
            );

            assert.strictEqual(
                result.data.payment.reference,
                firstPayment.reference
            );
        }
    );

    await test(
        "Unknown payment reference returns 404",
        async () => {
            const result =
                await httpRequest({
                    method: "GET",
                    path:
                        `/api/v1/payments/PP-DOES-NOT-EXIST`,
                    token
                });

            assert.strictEqual(
                result.status,
                404
            );
        }
    );

    await Payment.deleteMany({
        business: business._id
    });

    await Transaction.deleteMany({
        business: business._id
    });

    /*
     * Restore the original M-Pesa provider configuration.
     */
    if (originalProviderConfig) {
        await ProviderConfig.replaceOne(
            {
                _id:
                    originalProviderConfig._id
            },
            originalProviderConfig
        );
    } else {
        await ProviderConfig.deleteOne({
            provider: "mpesa"
        });
    }

    await Business.deleteOne({
        _id: business._id
    });

    await User.deleteOne({
        _id: user._id
    });

    mpesaProvider.initiatePayment =
        originalInitiatePayment;

    mpesaProvider.verifyPayment =
        originalVerifyPayment;

    await new Promise(resolve => {
        server.close(resolve);
    });

    await mongoose.disconnect();

    console.log("");
    console.log(
        "=============================================="
    );
    console.log(
        "PAYMENT API TEST PASSED ✓"
    );
    console.log(
        "=============================================="
    );
};

run().catch(async error => {
    mpesaProvider.initiatePayment =
        originalInitiatePayment;

    mpesaProvider.verifyPayment =
        originalVerifyPayment;

    console.error("");
    console.error(
        "PAYMENT API TEST FAILED:"
    );
    console.error(error);

    try {
        if (server) {
            await new Promise(resolve => {
                server.close(resolve);
            });
        }
    } catch (_) {}

    try {
        await mongoose.disconnect();
    } catch (_) {}

    process.exitCode = 1;
});
