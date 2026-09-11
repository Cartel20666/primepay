const {
    createOrder,
    captureOrder,
    getOrder
} = require("./paypal.orders");

const {
    refundCapture,
    getCapture
} = require("./paypal.payments");

const {
    verifyWebhookSignature
} = require("./paypal.webhook");

const {
    createCredentialFingerprint
} = require("../../utils/providerCredentials");

class PayPalProvider {
    constructor() {
        this.name = "paypal";

        this.environment =
            process.env.PAYPAL_ENVIRONMENT || "sandbox";

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
            process.env.PAYPAL_ENVIRONMENT,
            process.env.PAYPAL_CLIENT_ID,
            process.env.PAYPAL_CLIENT_SECRET
        ]);
    }

    isConfigured() {
        return Boolean(
            process.env.PAYPAL_CLIENT_ID &&
            process.env.PAYPAL_CLIENT_SECRET
        );
    }

    async validateCredentials() {
        if (!this.isConfigured()) {
            throw new Error(
                "PayPal client credentials are not configured."
            );
        }

        try {
            const {
                getOrdersController
            } = require("./paypal.auth");

            const ordersController =
                getOrdersController();

            await ordersController.ordersGet({
                id: "VALIDATION_ORDER_ID"
            });
        } catch (error) {
            const message =
                error?.body?.message ||
                error?.body?.details?.[0]?.description ||
                error?.message ||
                "";

            if (
                message &&
                !message.toLowerCase().includes(
                    "resource not found"
                ) &&
                !message.toLowerCase().includes(
                    "order not found"
                )
            ) {
                throw new Error(message);
            }

            return {
                authenticated: true,
                message:
                    "PayPal credentials are valid."
            };
        }

        return {
            authenticated: true,
            message:
                "PayPal credentials are valid."
        };
    }

    async initiatePayment(payment) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "PayPal credentials are not configured.",
                paymentReference: payment.reference
            };
        }

        try {
            const result = await createOrder({
                amount: payment.amount,
                currency: payment.currency,
                reference: payment.reference,
                description: payment.description,
                returnUrl: payment.metadata?.returnUrl,
                cancelUrl: payment.metadata?.cancelUrl
            });

            const approvalLink =
                Array.isArray(result.links)
                    ? result.links.find(
                        link =>
                            link.rel === "approve"
                    )
                    : null;

            return {
                success: true,
                provider: this.name,
                status: this.mapOrderStatus(
                    result.status
                ),
                paymentReference: payment.reference,
                providerTransactionId: result.id,
                providerReference: result.id,
                approvalUrl:
                    approvalLink?.href || null,
                providerResponse: {
                    id: result.id,
                    status: result.status,
                    links: result.links || []
                }
            };
        } catch (error) {
            console.error(
                "PayPal order creation error:",
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
                    "PayPal credentials are not configured.",
                providerReference
            };
        }

        if (!providerReference) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    "PayPal Order ID is required."
            };
        }

        try {
            const order =
                await getOrder(providerReference);

            const captured =
                this.findCapture(order);

            const status =
                captured?.status ||
                order.status ||
                "UNKNOWN";

            return {
                success:
                    status === "COMPLETED" ||
                    status === "COMPLETED".toUpperCase(),

                provider: this.name,

                status:
                    status === "COMPLETED"
                        ? "completed"
                        : this.mapOrderStatus(
                            order.status
                        ),

                providerReference: order.id,

                providerTransactionId:
                    captured?.id || order.id,

                providerResponse: {
                    id: order.id,
                    status: order.status,
                    captureId:
                        captured?.id || null,
                    captureStatus:
                        captured?.status || null
                }
            };
        } catch (error) {
            console.error(
                "PayPal verification error:",
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

    async capturePayment(providerReference) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "PayPal credentials are not configured.",
                providerReference
            };
        }

        if (!providerReference) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    "PayPal Order ID is required."
            };
        }

        try {
            const result =
                await captureOrder(
                    providerReference
                );

            const captured =
                this.findCapture(result);

            return {
                success:
                    result.status === "COMPLETED",

                provider: this.name,

                status:
                    result.status === "COMPLETED"
                        ? "completed"
                        : this.mapOrderStatus(
                            result.status
                        ),

                providerReference:
                    result.id,

                providerTransactionId:
                    captured?.id || result.id,

                providerResponse: {
                    id: result.id,
                    status: result.status,
                    captureId:
                        captured?.id || null,
                    captureStatus:
                        captured?.status || null
                }
            };
        } catch (error) {
            console.error(
                "PayPal capture error:",
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

    async refundPayment({
        providerReference,
        amount,
        currency
    }) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "PayPal credentials are not configured."
            };
        }

        if (!providerReference) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    "PayPal Capture ID is required."
            };
        }

        try {
            const result =
                await refundCapture({
                    captureId:
                        providerReference,
                    amount,
                    currency
                });

            return {
                success:
                    result.status === "COMPLETED",

                provider: this.name,

                status:
                    result.status === "COMPLETED"
                        ? "completed"
                        : "processing",

                providerReference:
                    result.id,

                providerTransactionId:
                    result.id,

                providerResponse: {
                    id: result.id,
                    status: result.status,
                    amount:
                        result.amount || null
                }
            };
        } catch (error) {
            console.error(
                "PayPal refund error:",
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

    async getCapture(providerReference) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "PayPal credentials are not configured."
            };
        }

        try {
            const result =
                await getCapture(
                    providerReference
                );

            return {
                success: true,
                provider: this.name,
                status:
                    result.status === "COMPLETED"
                        ? "completed"
                        : "processing",
                providerReference:
                    result.id,
                providerTransactionId:
                    result.id,
                providerResponse: result
            };
        } catch (error) {
            console.error(
                "PayPal capture lookup error:",
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

    async verifyWebhook({
        headers,
        webhookEvent
    }) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "PayPal credentials are not configured."
            };
        }

        try {
            const result =
                await verifyWebhookSignature({
                    headers,
                    webhookEvent
                });

            return {
                success: result.verified,
                provider: this.name,
                status: result.verified
                    ? "verified"
                    : "failed",
                verificationStatus:
                    result.status
            };
        } catch (error) {
            console.error(
                "PayPal webhook verification error:",
                error.message
            );

            return {
                success: false,
                provider: this.name,
                status: "failed",
                message: error.message
            };
        }
    }

    findCapture(order) {
        return (
            order?.purchaseUnits?.[0]
                ?.payments?.captures?.[0] ||
            null
        );
    }

    mapOrderStatus(status) {
        switch (status) {
            case "COMPLETED":
                return "completed";

            case "APPROVED":
                return "processing";

            case "CREATED":
            case "SAVED":
                return "pending";

            case "VOIDED":
                return "cancelled";

            default:
                return "processing";
        }
    }
}

module.exports = new PayPalProvider();
