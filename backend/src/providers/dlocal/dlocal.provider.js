const {
    createPayment,
    getPayment,
    getOrder,
findPaymentByOrderId,
    createRefund,
    getRefund
} = require("./dlocal.payment");

const {
    verifyNotificationSignature
} = require("./dlocal.webhook");

const {
    createCredentialFingerprint
} = require("../../utils/providerCredentials");

class DlocalProvider {
    constructor() {
        this.name = "dlocal";

        this.environment =
            process.env.DLOCAL_ENVIRONMENT ||
            "sandbox";

        this.supportedCurrencies = ["KES"];

        this.capabilities = {
            payments: true,
            cardPayments: true,
            bankPayments: true,
            mobileMoney: true,
            verification: true,
            refunds: true,
            payouts: false,
            webhooks: true,
            subscriptions: false,
            recovery: true
        };
    }

    getCredentialFingerprint() {
        return createCredentialFingerprint([
            process.env.DLOCAL_ENVIRONMENT,
            process.env.DLOCAL_X_LOGIN,
            process.env.DLOCAL_X_TRANS_KEY,
            process.env.DLOCAL_SECRET_KEY
        ]);
    }

    isConfigured() {
        return Boolean(
            process.env.DLOCAL_X_LOGIN &&
            process.env.DLOCAL_X_TRANS_KEY &&
            process.env.DLOCAL_SECRET_KEY
        );
    }

    async validateCredentials() {
        if (!this.isConfigured()) {
            throw new Error(
                "dLocal credentials are not configured."
            );
        }

        try {
            const axios = require("axios");
            const {
                getBaseUrl,
                createHeaders
            } = require("./dlocal.auth");

            const country =
                process.env.DLOCAL_VALIDATION_COUNTRY || "KE";

            const url =
                `${getBaseUrl()}/payments-methods?country=${encodeURIComponent(country)}`;

            const response = await axios.get(url, {
                headers: createHeaders("")
            });

            return {
                authenticated: true,
                country,
                paymentMethods:
                    Array.isArray(response.data)
                        ? response.data.length
                        : Array.isArray(response.data?.payment_methods)
                            ? response.data.payment_methods.length
                            : null,
                message:
                    "dLocal credentials are valid."
            };
        } catch (error) {
            const providerMessage =
                error.response?.data?.message ||
                error.response?.data?.error ||
                error.response?.data?.error_message;

            throw new Error(
                providerMessage ||
                error.message ||
                "dLocal credential validation failed."
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
                    "dLocal credentials are not configured.",
                paymentReference:
                    payment.reference
            };
        }

        try {
            const result =
                await createPayment({
                    amount:
                        payment.amount,

                    currency:
                        payment.currency,

                    country:
                        payment.country,

                    reference:
                        payment.reference,

                    description:
                        payment.description,

                    paymentMethodId:
                        payment.metadata
                            ?.paymentMethodId,

                    paymentMethodFlow:
                        payment.metadata
                            ?.paymentMethodFlow,

                    customerName:
                        payment.customerName,

                    customerEmail:
                        payment.customerEmail,

                    customerPhone:
                        payment.customerPhone,

                    notificationUrl:
                        payment.metadata
                            ?.notificationUrl,

                    callbackUrl:
                        payment.metadata
                            ?.callbackUrl
                });

            return {
                success: true,

                provider: this.name,

                status:
                    this.mapStatus(
                        result.status
                    ),

                paymentReference:
                    payment.reference,

                providerTransactionId:
                    result.id || null,

                providerReference:
                    result.id || null,

                providerResponse:
                    result
            };
        } catch (error) {
            console.error(
                "dLocal payment error:",
                error.response?.data ||
                error.message
            );

            const providerResponded =
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
                message:
                    error.response?.data
                        ?.message ||
                    error.message,
                paymentReference:
                    payment.reference,
                uncertainOutcome,
                providerResponded,
                providerResponse:
                    error.response?.data ||
                    null,
                statusCode:
                    error.response?.status ||
                    null
            };
        }
    }

    async verifyPayment(
        providerReference
    ) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "dLocal credentials are not configured.",
                providerReference
            };
        }

        if (!providerReference) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    "dLocal Payment ID is required."
            };
        }

        try {
            const result =
                await getPayment(
                    providerReference
                );

            const status =
                this.mapStatus(
                    result.status
                );

            return {
                success:
                    status === "completed",

                provider: this.name,

                status,

                providerReference:
                    result.id,

                providerTransactionId:
                    result.id,

                providerResponse:
                    result
            };
        } catch (error) {
            console.error(
                "dLocal payment verification error:",
                error.response?.data ||
                error.message
            );

            const providerResponded =
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
                message:
                    error.response?.data
                        ?.message ||
                    error.message,
                providerReference,
                uncertainOutcome,
                providerResponded,
                providerResponse:
                    error.response?.data ||
                    null,
                statusCode:
                    error.response?.status ||
                    null
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
                    "dLocal credentials are not configured."
            };
        }

        try {
            const result =
                await createRefund({
                    paymentId:
                        providerReference,

                    amount,

                    currency
                });

            return {
                success:
                    result.status ===
                    "SUCCESS",

                provider: this.name,

                status:
                    this.mapRefundStatus(
                        result.status
                    ),

                providerReference:
                    result.id,

                providerTransactionId:
                    result.id,

                providerResponse:
                    result
            };
        } catch (error) {
            console.error(
                "dLocal refund error:",
                error.response?.data ||
                error.message
            );

            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    error.response?.data
                        ?.message ||
                    error.message,
                providerReference
            };
        }
    }

    async getRefund(
        refundId
    ) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "dLocal credentials are not configured."
            };
        }

        try {
            const result =
                await getRefund(
                    refundId
                );

            return {
                success: true,
                provider: this.name,
                status:
                    this.mapRefundStatus(
                        result.status
                    ),
                providerReference:
                    result.id ||
                    refundId,
                providerTransactionId:
                    result.id ||
                    refundId,
                providerResponse:
                    result
            };
        } catch (error) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    error.response?.data
                        ?.message ||
                    error.message,
                providerReference:
                    refundId
            };
        }
    }

    async verifyWebhook({
        headers,
        rawBody
    }) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "dLocal credentials are not configured."
            };
        }

        try {
            const verified =
                verifyNotificationSignature({
                    headers,
                    rawBody
                });

            return {
                success: verified,
                provider: this.name,
                status:
                    verified
                        ? "verified"
                        : "failed"
            };
        } catch (error) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    error.message
            };
        }
    }

    async getTransaction(
        providerReference
    ) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured"
            };
        }

        try {
            const result =
                await getPayment(
                    providerReference
                );

            return {
                success: true,
                provider: this.name,
                status:
                    this.mapStatus(
                        result.status
                    ),
                providerReference:
                    result.id,
                providerTransactionId:
                    result.id,
                providerResponse:
                    result
            };
        } catch (error) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    error.response?.data
                        ?.message ||
                    error.message,
                providerReference
            };
        }
    }

    async getOrder(orderId) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured"
            };
        }

        try {
            const result =
                await getOrder(orderId);

            return {
                success: true,
                provider: this.name,
                status:
                    this.mapStatus(
                        result.status
                    ),
                providerReference:
                    result.payment_id ||
                    orderId,
                providerTransactionId:
                    result.payment_id ||
                    null,
                providerResponse:
                    result
            };
        } catch (error) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    error.response?.data
                        ?.message ||
                    error.message,
                providerReference:
                    orderId
            };
        }
    }
         async findPaymentByReference(
        reference
    ) {
        if (!this.isConfigured()) {
            return {
                success: false,
                provider: this.name,
                status: "not_configured",
                message:
                    "dLocal credentials are not configured.",
                paymentReference:
                    reference
            };
        }

        if (!reference) {
            return {
                success: false,
                provider: this.name,
                status: "failed",
                message:
                    "PrimePay payment reference is required."
            };
        }

        try {
            const order =
                await findPaymentByOrderId(
                    reference
                );

            if (!order) {
                return {
                    success: false,
                    provider: this.name,
                    status: "not_found",
                    paymentReference:
                        reference
                };
            }

            const paymentId =
                order.payment_id ||
                null;

            if (!paymentId) {
                return {
                    success: true,
                    provider: this.name,
                    status:
                        this.mapStatus(
                            order.status
                        ),
                    paymentReference:
                        reference,
                    providerReference:
                        reference,
                    providerTransactionId:
                        null,
                    providerResponse: {
                        order
                    }
                };
            }

            const payment =
                await getPayment(
                    paymentId
                );

            const status =
                this.mapStatus(
                    payment.status
                );

            return {
                success: true,
                provider: this.name,
                status,
                paymentReference:
                    reference,
                providerReference:
                    payment.id ||
                    paymentId,
                providerTransactionId:
                    payment.id ||
                    paymentId,
                providerResponse: {
                    order,
                    payment
                }
            };
        } catch (error) {
            console.error(
                "dLocal payment recovery error:",
                error.response?.data ||
                error.message
            );

            return {
                success: false,
                provider: this.name,
                status: "recovery_error",
                message:
                    error.response?.data
                        ?.message ||
                    error.message,
                paymentReference:
                    reference
            };
        }
    }
    mapStatus(status) {
        switch (
            String(status || "")
                .toUpperCase()
        ) {
            case "PAID":
            case "SUCCESS":
            case "COMPLETED":
                return "completed";

            case "PENDING":
            case "AUTHORIZED":
            case "IN_REVIEW":
                return "processing";

            case "REJECTED":
            case "CANCELLED":
            case "CANCELED":
                return "cancelled";

            default:
                return "processing";
        }
    }

    mapRefundStatus(status) {
        switch (
            String(status || "")
                .toUpperCase()
        ) {
            case "SUCCESS":
                return "completed";

            case "PENDING":
                return "processing";

            case "REJECTED":
            case "CANCELLED":
            case "CANCELED":
                return "failed";

            default:
                return "processing";
        }
    }
}

module.exports =
    new DlocalProvider();
