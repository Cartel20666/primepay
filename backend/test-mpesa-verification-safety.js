require("dotenv").config();

const axios = require("axios");

const mpesaProvider =
    require("./src/providers/mpesa/mpesa.provider");

async function main() {
    process.env.MPESA_CONSUMER_KEY =
        "test-consumer-key";

    process.env.MPESA_CONSUMER_SECRET =
        "test-consumer-secret";

    process.env.MPESA_SHORTCODE =
        "174379";

    process.env.MPESA_PASSKEY =
        "test-passkey";

    const originalPost = axios.post;

    axios.post = async () => {
        throw new Error(
            "Simulated Safaricom timeout"
        );
    };

    try {
        const result =
            await mpesaProvider.verifyPayment(
                "ws_CO_TEST_123"
            );

        if (
            result.status !== "processing"
        ) {
            throw new Error(
                `Expected processing, got ${result.status}`
            );
        }

        if (
            result.verificationPending !== true
        ) {
            throw new Error(
                "Expected verificationPending=true"
            );
        }

        if (
            result.success !== false
        ) {
            throw new Error(
                "Expected success=false"
            );
        }

        console.log(
            "PASS: Safaricom verification failure remains processing."
        );

        console.log(
            "PASS: verificationPending=true."
        );

        console.log(
            "\nMPESA VERIFICATION SAFETY TEST PASSED."
        );
    } finally {
        axios.post = originalPost;
    }
}

main().catch(error => {
    console.error(
        "\nMPESA VERIFICATION SAFETY TEST FAILED."
    );
    console.error(error);
    process.exit(1);
});
