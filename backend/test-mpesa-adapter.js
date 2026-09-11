require("dotenv").config();

const assert = require("assert");

const axios = require("axios");

const originalGet = axios.get;
const originalPost = axios.post;

let getCalls = [];
let postCalls = [];

axios.get = async (url, config) => {
    getCalls.push({
        url,
        config
    });

    return {
        data: {
            access_token: "TEST_ACCESS_TOKEN"
        }
    };
};

axios.post = async (url, body, config) => {
    postCalls.push({
        url,
        body,
        config
    });

    if (
        url.includes(
            "/mpesa/stkpush/v1/processrequest"
        )
    ) {
        return {
            data: {
                MerchantRequestID:
                    "29115-34620561-1",
                CheckoutRequestID:
                    "ws_CO_TEST_123456789",
                ResponseCode: "0",
                ResponseDescription:
                    "Success. Request accepted for processing",
                CustomerMessage:
                    "Success. Request accepted for processing"
            }
        };
    }

    if (
        url.includes(
            "/mpesa/stkpushquery/v1/query"
        )
    ) {
        return {
            data: {
                ResponseCode: "0",
                ResponseDescription:
                    "The service request has been accepted successfully",
                MerchantRequestID:
                    "29115-34620561-1",
                CheckoutRequestID:
                    "ws_CO_TEST_123456789",
                ResultCode: "0",
                ResultDesc: "The service request is processed successfully."
            }
        };
    }

    throw new Error(
        `Unexpected POST URL: ${url}`
    );
};

const {
    initiateStkPush,
    queryStkStatus
} = require("./src/providers/mpesa/mpesa.stk");

const mpesaProvider =
    require("./src/providers/mpesa/mpesa.provider");

const test = async (name, fn) => {
    try {
        await fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        throw error;
    }
};

const run = async () => {
    process.env.MPESA_ENVIRONMENT =
        "sandbox";

    process.env.MPESA_CONSUMER_KEY =
        "TEST_CONSUMER_KEY";

    process.env.MPESA_CONSUMER_SECRET =
        "TEST_CONSUMER_SECRET";

    process.env.MPESA_SHORTCODE =
        "174379";

    process.env.MPESA_PASSKEY =
        "TEST_PASSKEY";

    process.env.MPESA_CALLBACK_URL =
        "https://example.com/api/v1/mpesa/stk/callback";

    await test(
        "M-Pesa provider reports configured",
        async () => {
            assert.strictEqual(
                mpesaProvider.isConfigured(),
                true
            );
        }
    );

    await test(
        "M-Pesa sandbox OAuth uses sandbox endpoint",
        async () => {
            getCalls = [];

            const token =
                await require(
                    "./src/providers/mpesa/mpesa.auth"
                ).getMpesaAccessToken();

            assert.strictEqual(
                token,
                "TEST_ACCESS_TOKEN"
            );

            assert.strictEqual(
                getCalls.length,
                1
            );

            assert(
                getCalls[0].url.startsWith(
                    "https://sandbox.safaricom.co.ke/"
                )
            );

            assert(
                getCalls[0].config.headers.Authorization.startsWith(
                    "Basic "
                )
            );
        }
    );

    await test(
        "STK Push builds correct sandbox request",
        async () => {
            postCalls = [];

            const result =
                await initiateStkPush({
                    amount: 1500,
                    phone: "0712345678",
                    accountReference:
                        "PP-TEST-001",
                    transactionDesc:
                        "PrimePay Test Payment"
                });

            assert.strictEqual(
                result.CheckoutRequestID,
                "ws_CO_TEST_123456789"
            );

            assert.strictEqual(
                result.MerchantRequestID,
                "29115-34620561-1"
            );

            assert.strictEqual(
                postCalls.length,
                1
            );

            const call =
                postCalls[0];

            assert(
                call.url.startsWith(
                    "https://sandbox.safaricom.co.ke/"
                )
            );

            assert.strictEqual(
                call.body.BusinessShortCode,
                "174379"
            );

            assert.strictEqual(
                call.body.Amount,
                1500
            );

            assert.strictEqual(
                call.body.PartyA,
                "254712345678"
            );

            assert.strictEqual(
                call.body.PhoneNumber,
                "254712345678"
            );

            assert.strictEqual(
                call.body.PartyB,
                "174379"
            );

            assert.strictEqual(
                call.body.AccountReference,
                "PP-TEST-001"
            );

            assert.strictEqual(
                call.body.TransactionDesc,
                "PrimePay Test Payment"
            );

            assert.strictEqual(
                call.body.CallBackURL,
                process.env.MPESA_CALLBACK_URL
            );

            assert(
                call.body.Password
            );

            assert(
                call.body.Timestamp
            );

            assert.strictEqual(
                call.config.headers.Authorization,
                "Bearer TEST_ACCESS_TOKEN"
            );
        }
    );

    await test(
        "STK query uses CheckoutRequestID",
        async () => {
            postCalls = [];

            const result =
                await queryStkStatus({
                    checkoutRequestId:
                        "ws_CO_TEST_123456789"
                });

            assert.strictEqual(
                result.ResultCode,
                "0"
            );

            assert.strictEqual(
                result.checkoutRequestId,
                "ws_CO_TEST_123456789"
            );

            assert.strictEqual(
                postCalls.length,
                1
            );

            const call =
                postCalls[0];

            assert(
                call.url.includes(
                    "/mpesa/stkpushquery/v1/query"
                )
            );

            assert.strictEqual(
                call.body.CheckoutRequestID,
                "ws_CO_TEST_123456789"
            );

            assert.strictEqual(
                call.body.BusinessShortCode,
                "174379"
            );

            assert(
                call.body.Password
            );

            assert(
                call.body.Timestamp
            );
        }
    );

    await test(
        "Provider initiatePayment maps Daraja IDs correctly",
        async () => {
            const result =
                await mpesaProvider.initiatePayment({
                    amount: 1500,
                    customerPhone:
                        "0712345678",
                    reference:
                        "PP-TEST-002",
                    description:
                        "Adapter Test"
                });

            assert.strictEqual(
                result.success,
                true
            );

            assert.strictEqual(
                result.status,
                "processing"
            );

            assert.strictEqual(
                result.providerTransactionId,
                "ws_CO_TEST_123456789"
            );

            assert.strictEqual(
                result.providerReference,
                "ws_CO_TEST_123456789"
            );

            assert.strictEqual(
                result.checkoutRequestId,
                "ws_CO_TEST_123456789"
            );

            assert.strictEqual(
                result.merchantRequestId,
                "29115-34620561-1"
            );
        }
    );

    await test(
        "Provider verification maps successful Daraja result",
        async () => {
            const result =
                await mpesaProvider.verifyPayment(
                    "ws_CO_TEST_123456789"
                );

            assert.strictEqual(
                result.success,
                true
            );

            assert.strictEqual(
                result.status,
                "completed"
            );

            assert.strictEqual(
                result.providerReference,
                "ws_CO_TEST_123456789"
            );

            assert.strictEqual(
                result.providerTransactionId,
                "ws_CO_TEST_123456789"
            );
        }
    );

    await test(
        "Invalid phone number is rejected",
        async () => {
            let failed = false;

            try {
                await initiateStkPush({
                    amount: 100,
                    phone: "12345",
                    accountReference:
                        "PP-TEST-003",
                    transactionDesc:
                        "Invalid Phone"
                });
            } catch (error) {
                failed = true;

                assert.strictEqual(
                    error.message,
                    "Invalid Kenyan phone number."
                );
            }

            assert.strictEqual(
                failed,
                true
            );
        }
    );

    await test(
        "Missing CheckoutRequestID is rejected",
        async () => {
            const result =
                await mpesaProvider.verifyPayment(
                    null
                );

            assert.strictEqual(
                result.success,
                false
            );

            assert.strictEqual(
                result.status,
                "failed"
            );
        }
    );

    axios.get = originalGet;
    axios.post = originalPost;

    console.log("");
    console.log("==============================================");
    console.log("M-PESA ADAPTER TEST PASSED ✓");
    console.log("==============================================");
};

run().catch(error => {
    axios.get = originalGet;
    axios.post = originalPost;

    console.error("");
    console.error("M-PESA ADAPTER TEST FAILED:");
    console.error(error);

    process.exitCode = 1;
});
