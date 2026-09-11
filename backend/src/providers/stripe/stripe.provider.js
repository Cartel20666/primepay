const {
    createPaymentIntent,
    retrievePaymentIntent,
    refundPaymentIntent
} = require("./stripe.payment");

const {
    constructWebhookEvent
} = require("./stripe.webhook");

const {
    createCredentialFingerprint
} = require("../../utils/providerCredentials");

class StripeProvider {
    constructor() {
        this.name = "stripe";

        this.environment =
            process.env.STRIPE_ENVIRONMENT || "sandbox";

        this.supportedCurrencies = ["KES", "USD", "EUR", "GBP"];
        this.capabilities = {
            payments: true,
            cardPayments: true,
            bankPayments: false,
            mobileMoney: false,
            verification: true,
            refunds: true,
            payouts: false,
            webhooks: true,
            subscriptions: false,
            recovery: false
        };
    }

    getCredentialFingerprint() {
        return createCredentialFingerprint([
            process.env.STRIPE_ENVIRONMENT,
            process.env.STRIPE_SECRET_KEY
        ]);
    }

    isConfigured() {
        return Boolean(
            process.env.STRIPE_SECRET_KEY
        );
    }

    async validateCredentials() {
        if (!this.isConfigured()) {
            throw new Error(
                "Stripe secret key is not configured."
            );
        }

        try {
            const { getStripeClient } =
                require("./stripe.auth");

            const stripe = getStripeClient();

            const account = await stripe.accounts.retrieve();

            return {
                authenticated: true,
                accountId: account.id,
                message:
                    "Stripe credentials are valid."
            };
        } catch (error) {
            throw new Error(
                error.message ||
                "Stripe credential validation failed."
            );
        }
    }

    async initiatePayment(payment) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "Stripe credentials are not configured.",
                paymentReference: payment.reference
            };
        }

        try {
            const result =
                await createPaymentIntent({
                    amount: payment.amount,
                    currency: payment.currency,
                    reference: payment.reference,
                    description: payment.description,
                    customerEmail:
                        payment.customerEmail,
                    metadata: payment.metadata
                });

            return {
                success: true,
                provider: this.name,
                status: this.mapStatus(
                    result.status
                ),
                paymentReference:
                    payment.reference,
                providerTransactionId:
                    result.id,
                providerReference:
                    result.id,
                clientSecret:
                    result.client_secret,
                providerResponse: {
                    id: result.id,
                    status: result.status,
                    amount: result.amount,
                    currency: result.currency
                }
            };
        } catch (error) {
            console.error(
                "Stripe payment error:",
                error.message
            );

            const providerResponded =
                Boolean(error.raw?.statusCode) ||
                Boolean(error.statusCode) ||
                Boolean(error.response);

            const uncertainOutcome =
                !providerResponded;

            return {
                success: false,
                provider: this.name,
                status:
                    uncertainOutcome
                        ? "processing"
                        : "failed",
                message: error.message,
                paymentReference:
                    payment.reference,
                uncertainOutcome,
                providerResponded,
                providerResponse:
                    error.raw ||
                    error.response?.data ||
                    null,
                statusCode:
                    error.statusCode ||
                    error.raw?.statusCode ||
                    null
            };
        }
    }

    async verifyPayment(providerReference) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "Stripe credentials are not configured.",
                providerReference
            };
        }

        if (!providerReference) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    "Stripe PaymentIntent ID is required."
            };
        }

        try {
            const result =
                await retrievePaymentIntent(
                    providerReference
                );

            return {
                success:
                    result.status === "succeeded",

                provider: this.name,

                status:
                    this.mapStatus(
                        result.status
                    ),

                providerReference:
                    result.id,

                providerTransactionId:
                    result.id,

                providerResponse: {
                    id: result.id,
                    status: result.status,
                    amount: result.amount,
                    currency: result.currency
                }
            };
        } catch (error) {
            console.error(
                "Stripe verification error:",
                error.message
            );

            const providerResponded =
                Boolean(error.raw?.statusCode) ||
                Boolean(error.statusCode) ||
                Boolean(error.response);

            const uncertainOutcome =
                !providerResponded;

            return {
                success: false,
                provider: this.name,
                status:
                    uncertainOutcome
                        ? "processing"
                        : "failed",
                message: error.message,
                providerReference,
                uncertainOutcome,
                providerResponded,
                providerResponse:
                    error.raw ||
                    error.response?.data ||
                    null,
                statusCode:
                    error.statusCode ||
                    error.raw?.statusCode ||
                    null
            };
        }
    }

    async refundPayment({
        providerReference,
        amount
    }) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "Stripe credentials are not configured."
            };
        }

        try {
            const result =
                await refundPaymentIntent({
                    paymentIntentId:
                        providerReference,
                    amount
                });

            return {
                success: true,
                provider: this.name,
                status:
                    result.status === "succeeded"
                        ? "completed"
                        : "processing",

                providerReference:
                    result.id,

                providerTransactionId:
                    result.id,

                providerResponse: {
                    id: result.id,
                    status: result.status,
                    amount: result.amount,
                    currency: result.currency
                }
            };
        } catch (error) {
            console.error(
                "Stripe refund error:",
                error.message
            );

            return {
                success: false,
                provider: this.name,
                status: "failed",
                message: error.message,
                providerReference
            };
        }
    }

    parseWebhook(payload, signature) {
        return constructWebhookEvent(
            payload,
            signature
        );
    }

    mapStatus(status) {
        switch (status) {
            case "succeeded":
                return "completed";

            case "processing":
                return "processing";

            case "requires_payment_method":
            case "requires_confirmation":
            case "requires_action":
                return "pending";

            case "canceled":
                return "cancelled";

            default:
                return "processing";
        }
    }
}

module.exports = new StripeProvider();
