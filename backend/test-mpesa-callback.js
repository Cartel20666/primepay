require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const Payment = require("./src/models/Payment");
const Transaction = require("./src/models/Transaction");

const providerRegistry =
    require("./src/providers/provider.registry");

const mpesaProvider =
    require("./src/providers/mpesa/mpesa.provider");

const {
    handleStkCallback
} = require("./src/controllers/mpesa.controller");

const originalVerify =
    mpesaProvider.verifyPayment;

const test = async (name, fn) => {
    try {
        await fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        throw error;
    }
};

const createMockResponse = () => {
    const response = {
        statusCode: 200,
        body: null
    };

    return {
        response,

        status(code) {
            response.statusCode = code;
            return this;
        },

        json(body) {
            response.body = body;
            return this;
        }
    };
};

const run = async () => {
    await require("./src/config.database")();

    const businessId =
        new mongoose.Types.ObjectId();

    const transactionId =
        new mongoose.Types.ObjectId();

    const paymentId =
        new mongoose.Types.ObjectId();

    const checkoutRequestId =
        `ws_CO_CALLBACK_${Date.now()}`;

    const payment = await Payment.create({
        _id: paymentId,
        business: businessId,
        transaction: transactionId,
        reference:
            `PP-CALLBACK-${Date.now()}`,
        idempotencyKey:
            `idem-callback-${Date.now()}-${Math.random()}`,
        amount: 1500,
        currency: "KES",
        provider: "mpesa",
        checkoutRequestId,
        providerReference:
            checkoutRequestId,
        status: "processing",
        reconciliationStatus:
            "not_required"
    });

await Transaction.create({
    _id: transactionId,
    business: businessId,
    type: "payment",
    payment: paymentId,
    reference:
        payment.reference,
    amount: 1500,
    currency: "KES",
    provider: "mpesa",
    status: "processing"
});
    let verificationCalls = 0;

    mpesaProvider.verifyPayment =
        async reference => {
            verificationCalls += 1;

            assert.strictEqual(
                reference,
                checkoutRequestId
            );

            return {
                success: true,
                provider: "mpesa",
                status: "completed",
                providerReference:
                    reference,
                providerTransactionId:
                    reference,
                providerResponse: {
                    ResultCode: "0",
                    ResultDesc:
                        "Verified successfully"
                }
            };
        };

    await test(
        "Successful callback performs server-side verification",
        async () => {
            const req = {
                body: {
                    Body: {
                        stkCallback: {
                            ResultCode: 0,
                            ResultDesc:
                                "Success",
                            CheckoutRequestID:
                                checkoutRequestId,
                            CallbackMetadata: {
                                Item: [
                                    {
                                        Name:
                                            "Amount",
                                        Value: 1500
                                    },
                                    {
                                        Name:
                                            "MpesaReceiptNumber",
                                        Value:
                                            "TESTRECEIPT001"
                                    },
                                    {
                                        Name:
                                            "PhoneNumber",
                                        Value:
                                            254712345678
                                    }
                                ]
                            }
                        }
                    }
                }
            };

            const {
                response
            } = createMockResponse();

            const res =
                createMockResponse();

            await handleStkCallback(
                req,
                res
            );

            assert.strictEqual(
                res.response.statusCode,
                200
            );

            assert.strictEqual(
                verificationCalls,
                1
            );

            assert.strictEqual(
                res.response.body.ResultCode,
                0
            );
        }
    );

    await test(
        "Payment becomes completed after independent verification",
        async () => {
            const updated =
                await Payment.findById(
                    paymentId
                );

            assert.strictEqual(
                updated.status,
                "completed"
            );

            assert(
                updated.metadata?.mpesaCallback
            );
        }
    );

    await test(
        "Unknown callback never creates a payment",
        async () => {
            const unknownId =
                `ws_CO_UNKNOWN_${Date.now()}`;

            const req = {
                body: {
                    Body: {
                        stkCallback: {
                            ResultCode: 0,
                            ResultDesc:
                                "Success",
                            CheckoutRequestID:
                                unknownId
                        }
                    }
                }
            };

            const res =
                createMockResponse();

            await handleStkCallback(
                req,
                res
            );

            assert.strictEqual(
                res.response.statusCode,
                200
            );

            const count =
                await Payment.countDocuments({
                    checkoutRequestId:
                        unknownId
                });

            assert.strictEqual(
                count,
                0
            );
        }
    );

    await test(
        "Missing CheckoutRequestID is rejected",
        async () => {
            const req = {
                body: {
                    Body: {
                        stkCallback: {
                            ResultCode: 0,
                            ResultDesc:
                                "Success"
                        }
                    }
                }
            };

            const res =
                createMockResponse();

            await handleStkCallback(
                req,
                res
            );

            assert.strictEqual(
                res.response.statusCode,
                400
            );

            assert.strictEqual(
                res.response.body.ResultCode,
                1
            );
        }
    );

    await test(
        "Failed callback does not invoke verification",
        async () => {
            verificationCalls = 0;

            const processingPayment =
                await Payment.create({
                    business: businessId,
                    transaction:
                        new mongoose.Types.ObjectId(),
                    reference:
                        `PP-FAILED-${Date.now()}`,
                    idempotencyKey:
                        `idem-failed-${Date.now()}-${Math.random()}`,
                    amount: 500,
                    currency: "KES",
                    provider: "mpesa",
                    checkoutRequestId:
                        `ws_CO_FAILED_${Date.now()}`,
                    status: "processing",
                    reconciliationStatus:
                        "not_required"
                });

await Transaction.create({
    _id: processingPayment.transaction,
    business: businessId,
    type: "payment",
    payment: processingPayment._id,
    reference: processingPayment.reference,
    amount: 500,
    currency: "KES",
    provider: "mpesa",
    status: "processing"
});
            const req = {
                body: {
                    Body: {
                        stkCallback: {
                            ResultCode: 1032,
                            ResultDesc:
                                "Request cancelled by user",
                            CheckoutRequestID:
                                processingPayment.checkoutRequestId
                        }
                    }
                }
            };

            const res =
                createMockResponse();

            await handleStkCallback(
                req,
                res
            );

            assert.strictEqual(
                verificationCalls,
                0
            );

            const updated =
                await Payment.findById(
                    processingPayment._id
                );

            assert.strictEqual(
                updated.status,
                "failed"
            );
        }
    );

    await test(
        "Duplicate successful callback remains idempotent",
        async () => {
            const req = {
                body: {
                    Body: {
                        stkCallback: {
                            ResultCode: 0,
                            ResultDesc: "Success",
                            CheckoutRequestID:
                                checkoutRequestId,
                            CallbackMetadata: {
                                Item: [
                                    {
                                        Name: "Amount",
                                        Value: 1500
                                    },
                                    {
                                        Name: "MpesaReceiptNumber",
                                        Value: "TESTRECEIPT001"
                                    },
                                    {
                                        Name: "PhoneNumber",
                                        Value: 254712345678
                                    }
                                ]
                            }
                        }
                    }
                }
            };

            const res = createMockResponse();

            await handleStkCallback(req, res);

            assert.strictEqual(
                res.response.statusCode,
                200
            );

            const updated =
                await Payment.findById(paymentId);

            assert.strictEqual(
                updated.status,
                "completed"
            );

            assert.strictEqual(
                verificationCalls,
                1
            );

            const transaction =
                await Transaction.findById(transactionId);

            assert.strictEqual(
                transaction.status,
                "completed"
            );
        }
    );

    await Payment.deleteMany({
        business: businessId
    });

    await Transaction.deleteMany({
        business: businessId
    });

    mpesaProvider.verifyPayment =
        originalVerify;

    console.log("");
    console.log(
        "=============================================="
    );
    console.log(
        "M-PESA CALLBACK HARDENING TEST PASSED ✓"
    );
    console.log(
        "=============================================="
    );

    process.exit(0);
};

run().catch(async error => {
    mpesaProvider.verifyPayment =
        originalVerify;

    console.error("");
    console.error(
        "M-PESA CALLBACK HARDENING TEST FAILED:"
    );
    console.error(error);

    process.exitCode = 1;
});
