const {
    initiateStkPush,
    queryStkStatus
} = require("./mpesa.stk");

const {
    createCredentialFingerprint
} = require("../../utils/providerCredentials");

class MpesaProvider {
    constructor() {
        this.name = "mpesa";

        this.environment =
            process.env.MPESA_ENVIRONMENT || "sandbox";

        this.supportedCurrencies = ["KES"];
        this.capabilities = {
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
        };
    }

    getCredentialFingerprint() {
        return createCredentialFingerprint([
            process.env.MPESA_ENVIRONMENT,
            process.env.MPESA_CONSUMER_KEY,
            process.env.MPESA_CONSUMER_SECRET,
            process.env.MPESA_SHORTCODE,
            process.env.MPESA_PASSKEY,
            process.env.MPESA_CALLBACK_URL
        ]);
    }

    isConfigured() {
        return Boolean(
            process.env.MPESA_CONSUMER_KEY &&
            process.env.MPESA_CONSUMER_SECRET &&
            process.env.MPESA_SHORTCODE &&
            process.env.MPESA_PASSKEY &&
            process.env.MPESA_CALLBACK_URL
        );
    }

    async validateCredentials() {
        const requiredConfig = [
            process.env.MPESA_CONSUMER_KEY,
            process.env.MPESA_CONSUMER_SECRET,
            process.env.MPESA_SHORTCODE,
            process.env.MPESA_PASSKEY,
            process.env.MPESA_CALLBACK_URL
        ];

        if (requiredConfig.some(value => !value)) {
            throw new Error(
                "M-Pesa credential configuration is incomplete."
            );
        }

        try {
            await require("./mpesa.auth").getMpesaAccessToken();

            return {
                authenticated: true,
                message:
                    "M-Pesa Daraja credentials are valid."
            };
        } catch (error) {
            throw new Error(
                error.response?.data?.errorMessage ||
                error.response?.data?.error_description ||
                error.message ||
                "M-Pesa credential validation failed."
            );
        }
    }

    async initiatePayment(payment) {
        const requiredConfig = [
            process.env.MPESA_CONSUMER_KEY,
            process.env.MPESA_CONSUMER_SECRET,
            process.env.MPESA_SHORTCODE,
            process.env.MPESA_PASSKEY,
            process.env.MPESA_CALLBACK_URL
        ];

        if (requiredConfig.some(value => !value)) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "M-Pesa STK Push configuration is incomplete.",
                paymentReference: payment.reference
            };
        }

        try {
            const result = await initiateStkPush({
                amount: payment.amount,
                phone: payment.customerPhone,
                accountReference: payment.reference,
                transactionDesc:
                    payment.description ||
                    "PrimePay Payment"
            });

            return {
                success: true,
                provider: this.name,
                status: "processing",
                paymentReference:
                    payment.reference,
                providerTransactionId:
                    result.CheckoutRequestID || null,
                providerReference:
                    result.CheckoutRequestID || null,
                checkoutRequestId:
                    result.CheckoutRequestID || null,
                merchantRequestId:
                    result.MerchantRequestID || null,
                providerResponse: result
            };
        } catch (error) {
            console.error(
                "M-Pesa STK Push error:",
                error.message
            );

            return {
                success: false,
                provider: this.name,
                status:
                    error.uncertainOutcome
                        ? "processing"
                        : "failed",
                message: error.message,
                paymentReference:
                    payment.reference,
                uncertainOutcome:
                    Boolean(
                        error.uncertainOutcome
                    ),
                providerResponded:
                    Boolean(
                        error.providerResponded
                    ),
                providerResponse:
                    error.providerResponse ||
                    null,
                statusCode:
                    error.statusCode ||
                    null
            };
        }
    }

    async verifyPayment(providerReference) {
        if (!providerReference) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    "M-Pesa Checkout Request ID is required."
            };
        }

        const requiredConfig = [
            process.env.MPESA_CONSUMER_KEY,
            process.env.MPESA_CONSUMER_SECRET,
            process.env.MPESA_SHORTCODE,
            process.env.MPESA_PASSKEY
        ];

        if (requiredConfig.some(value => !value)) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "M-Pesa verification configuration is incomplete.",
                providerReference
            };
        }

        try {
            const result = await queryStkStatus({
                checkoutRequestId:
                    providerReference
            });

            const resultCode =
                Number(result.ResultCode);

            let status = "processing";

            if (resultCode === 0) {
                status = "completed";
            } else if (
                Number.isFinite(resultCode)
            ) {
                status = "failed";
            }

            return {
                success: resultCode === 0,
                provider: this.name,
                status,
                message:
                    result.ResultDesc || null,
                providerReference,
                providerTransactionId:
                    providerReference,
                providerResponse: result
            };
        } catch (error) {
            console.error(
                "M-Pesa STK Query error:",
                error.message
            );

            return {
                success: false,
                provider: this.name,
                status: "processing",
                message:
                    `M-Pesa verification could not be completed: ${error.message}`,
                providerReference,
                providerTransactionId:
                    providerReference,
                verificationPending: true
            };
        }
    }
}

module.exports = new MpesaProvider();
