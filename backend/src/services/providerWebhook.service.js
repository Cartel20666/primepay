const crypto = require("crypto");
const Payment = require("../models/Payment");
const ProviderWebhookEvent =
    require("../models/ProviderWebhookEvent");

const {
    getProvider
} = require("../providers/provider.registry");

const {
    synchronizePaymentStatus
} = require("./paymentStatus.service");

const parseBody = (rawBody) => {
    if (
        rawBody === undefined ||
        rawBody === null
    ) {
        throw new Error(
            "Webhook body is required."
        );
    }

    if (Buffer.isBuffer(rawBody)) {
        return JSON.parse(
            rawBody.toString("utf8")
        );
    }

    if (typeof rawBody === "string") {
        return JSON.parse(rawBody);
    }

    return rawBody;
};

const getRawBody = (rawBody) => {
    if (Buffer.isBuffer(rawBody)) {
        return rawBody.toString("utf8");
    }

    if (typeof rawBody === "string") {
        return rawBody;
    }

    return JSON.stringify(
        rawBody || {}
    );
};

const isDuplicateKeyError = (error) => {
    return Boolean(
        error &&
        error.code === 11000
    );
};

const findPayment = async ({
    provider,
    payload
}) => {
    if (provider === "mpesa") {
        const checkoutRequestId =
            payload?.Body
                ?.stkCallback
                ?.CheckoutRequestID;

        if (!checkoutRequestId) {
            return null;
        }

        return Payment.findOne({
            provider: "mpesa",
            $or: [
                {
                    checkoutRequestId
                },
                {
                    providerReference:
                        checkoutRequestId
                },
                {
                    providerTransactionId:
                        checkoutRequestId
                }
            ]
        });
    }

    if (provider === "stripe") {
        const paymentIntentId =
            payload?.data
                ?.object
                ?.id;

        if (!paymentIntentId) {
            return null;
        }

        return Payment.findOne({
            provider: "stripe",
            $or: [
                {
                    providerReference:
                        paymentIntentId
                },
                {
                    providerTransactionId:
                        paymentIntentId
                }
            ]
        });
    }

    if (provider === "paypal") {
        const resourceId =
            payload?.resource
                ?.id;

        const supplementaryId =
            payload?.resource
                ?.supplementary_data
                ?.related_ids
                ?.order_id;

        const ids = [
            resourceId,
            supplementaryId
        ].filter(Boolean);

        if (!ids.length) {
            return null;
        }

        return Payment.findOne({
            provider: "paypal",
            $or: [
                {
                    providerReference: {
                        $in: ids
                    }
                },
                {
                    providerTransactionId: {
                        $in: ids
                    }
                }
            ]
        });
    }

    if (provider === "dlocal") {
        const providerId =
            payload?.id;

        const orderId =
            payload?.order_id;

        const ids = [
            providerId,
            orderId
        ].filter(Boolean);

        if (!ids.length) {
            return null;
        }

        return Payment.findOne({
            provider: "dlocal",
            $or: [
                {
                    providerReference: {
                        $in: ids
                    }
                },
                {
                    providerTransactionId: {
                        $in: ids
                    }
                },
                {
                    reference: {
                        $in: ids
                    }
                }
            ]
        });
    }

    return null;
};

const normalizeProviderWebhook =
    ({
        provider,
        payload
    }) => {
        if (provider === "mpesa") {
            const callback =
                payload?.Body
                    ?.stkCallback;

            if (!callback) {
                throw new Error(
                    "Invalid M-Pesa STK callback."
                );
            }

            const resultCode =
                Number(
                    callback.ResultCode
                );

            if (
                !Number.isFinite(
                    resultCode
                )
            ) {
                throw new Error(
                    "Invalid M-Pesa ResultCode."
                );
            }

            let status;

            if (resultCode === 0) {
                status =
                    "completed";
            } else {
                status =
                    "failed";
            }

            return {
                eventId:
                    callback.CheckoutRequestID,

                eventType:
                    "mpesa.stk.callback",

                providerReference:
                    callback.CheckoutRequestID,

                providerTransactionId:
                    callback.CheckoutRequestID,

                status,

                message:
                    callback.ResultDesc ||
                    null,

                providerResponse:
                    callback
            };
        }

        if (provider === "stripe") {
            const object =
                payload?.data
                    ?.object;

            if (!object) {
                throw new Error(
                    "Invalid Stripe webhook event."
                );
            }

            let status;

            switch (
                payload.type
            ) {
                case "payment_intent.succeeded":
                    status =
                        "completed";
                    break;

                case "payment_intent.payment_failed":
                    status =
                        "failed";
                    break;

                case "payment_intent.canceled":
                    status =
                        "cancelled";
                    break;

                case "payment_intent.processing":
                    status =
                        "processing";
                    break;

                default:
                    return {
                        eventId:
                            payload.id,

                        eventType:
                            payload.type,

                        status:
                            "ignored",

                        message:
                            "Unsupported Stripe webhook event type.",

                        providerResponse:
                            object
                    };
            }

            return {
                eventId:
                    payload.id,

                eventType:
                    payload.type,

                providerReference:
                    object.id,

                providerTransactionId:
                    object.id,

                status,

                message:
                    object.last_payment_error
                        ?.message ||
                    null,

                providerResponse:
                    object
            };
        }

        if (provider === "paypal") {
            const resource =
                payload?.resource;

            if (!resource) {
                throw new Error(
                    "Invalid PayPal webhook event."
                );
            }

            let status;

            switch (
                payload.event_type
            ) {
                case "PAYMENT.CAPTURE.COMPLETED":
                case "CHECKOUT.ORDER.COMPLETED":
                    status =
                        "completed";
                    break;

                case "PAYMENT.CAPTURE.DENIED":
                case "PAYMENT.CAPTURE.DECLINED":
                    status =
                        "failed";
                    break;

                case "PAYMENT.CAPTURE.REFUNDED":
                    status =
                        "refunded";
                    break;

                default:
                    return {
                        eventId:
                            payload.id,

                        eventType:
                            payload.event_type,

                        status:
                            "ignored",

                        message:
                            "Unsupported PayPal webhook event type.",

                        providerResponse:
                            resource
                    };
            }

            return {
                eventId:
                    payload.id,

                eventType:
                    payload.event_type,

                providerReference:
                    resource.id,

                providerTransactionId:
                    resource.id,

                status,

                message:
                    resource.status_details
                        ?.reason ||
                    null,

                providerResponse:
                    resource
            };
        }

        if (provider === "dlocal") {
            if (!payload?.id) {
                throw new Error(
                    "Invalid dLocal payment notification."
                );
            }

            let status;

            switch (
                String(
                    payload.status ||
                    ""
                ).toUpperCase()
            ) {
                case "PAID":
                case "SUCCESS":
                case "COMPLETED":
                    status =
                        "completed";
                    break;

                case "REJECTED":
                    status =
                        "failed";
                    break;

                case "CANCELLED":
                case "CANCELED":
                    status =
                        "cancelled";
                    break;

                case "PENDING":
                case "AUTHORIZED":
                case "IN_REVIEW":
                case "APPROVED":
                    status =
                        "processing";
                    break;

                default:
                    return {
                        eventId:
                            payload.id,

                        eventType:
                            "dlocal.payment.notification",

                        status:
                            "ignored",

                        message:
                            "Unsupported dLocal payment status.",

                        providerResponse:
                            payload
                    };
            }

            return {
                eventId:
                    payload.id,

                eventType:
                    "dlocal.payment.notification",

                providerReference:
                    payload.id,

                providerTransactionId:
                    payload.id,

                status,

                message:
                    payload.status_detail ||
                    null,

                providerResponse:
                    payload
            };
        }

        throw new Error(
            `Unsupported provider "${provider}".`
        );
    };

const verifyProviderWebhook =
    async ({
        provider,
        headers,
        payload,
        rawBody
    }) => {
        const paymentProvider =
            getProvider(provider);

        if (!headers) {
            throw new Error(
                "Webhook headers are required."
            );
        }

        if (provider === "stripe") {
            const signature =
                headers["stripe-signature"];

            if (!signature) {
                throw new Error(
                    "Stripe webhook signature is missing."
                );
            }

            const event =
                paymentProvider.parseWebhook(
                    rawBody,
                    signature
                );

            return {
                verified: true,
                payload: event
            };
        }

        if (provider === "paypal") {
            const result =
                await paymentProvider.verifyWebhook({
                    headers,
                    webhookEvent:
                        payload
                });

            if (!result.success) {
                throw new Error(
                    "PayPal webhook signature verification failed."
                );
            }

            return {
                verified: true,
                payload
            };
        }

        if (provider === "dlocal") {
            const result =
                await paymentProvider.verifyWebhook({
                    headers,
                    rawBody
                });

            if (!result.success) {
                throw new Error(
                    "dLocal webhook signature verification failed."
                );
            }

            return {
                verified: true,
                payload
            };
        }

        if (provider === "mpesa") {
            const checkoutRequestId =
                payload?.Body
                    ?.stkCallback
                    ?.CheckoutRequestID;

            if (!checkoutRequestId) {
                throw new Error(
                    "M-Pesa webhook CheckoutRequestID is required."
                );
            }

            const verificationResult =
                await paymentProvider.verifyPayment(
                    checkoutRequestId
                );

            if (
                verificationResult?.status ===
                    "not_configured" ||
                verificationResult?.status ===
                    "recovery_error"
            ) {
                throw new Error(
                    verificationResult.message ||
                    "M-Pesa payment verification could not be completed."
                );
            }

            return {
                verified: true,
                payload,
                verificationResult
            };
        }

        throw new Error(
            `Unsupported provider "${provider}".`
        );
    };

const createWebhookEventSafely =
    async ({
        provider,
        normalized,
        payload
    }) => {
        try {
            return {
                created: true,
                event:
                    await ProviderWebhookEvent.create({
                        provider,
                        eventId:
                            normalized.eventId,
                        eventType:
                            normalized.eventType,
                        providerReference:
                            normalized.providerReference,
                        status:
                            normalized.status ===
                            "ignored"
                                ? "ignored"
                                : "received",
                        payload
                    })
            };
        } catch (error) {
            if (!isDuplicateKeyError(error)) {
                throw error;
            }

            const existingEvent =
                await ProviderWebhookEvent.findOne({
                    provider,
                    eventId:
                        normalized.eventId
                });

            if (!existingEvent) {
                throw error;
            }

            return {
                created: false,
                event:
                    existingEvent
            };
        }
    };

const claimWebhookEvent =
    async ({
        provider,
        eventId
    }) => {
        const token =
            crypto.randomUUID();

        const now =
            new Date();

        const leaseUntil =
            new Date(
                now.getTime() +
                30 * 1000
            );

        const claimed =
            await ProviderWebhookEvent.findOneAndUpdate(
                {
                    provider,
                    eventId,

                    $or: [
                        {
                            status: "received",
                            processingAt: null
                        },
                        {
                            status: "failed"
                        },
                        {
                            status: "received",
                            processingAt: {
                                $lt: now
                            }
                        }
                    ]
                },
                {
                    $set: {
                        status: "received",
                        processingAt: leaseUntil,
                        processingToken: token,
                        error: null
                    }
                },
                {
                    returnDocument: "after"
                }
            );

        if (!claimed) {
            return null;
        }

        return {
            event: claimed,
            token
        };
    };

const processProviderWebhook =
    async ({
        provider,
        headers,
        rawBody
    }) => {
        const payload =
            parseBody(rawBody);

        const rawPayload =
            getRawBody(rawBody);

        const verification =
            await verifyProviderWebhook({
                provider,
                headers,
                payload,
                rawBody:
                    rawPayload
            });

        if (!verification.verified) {
            throw new Error(
                "Provider webhook verification failed."
            );
        }

        const normalized =
            normalizeProviderWebhook({
                provider,
                payload:
                    verification.payload
            });

        /*
         * For M-Pesa, the callback is only the trigger
         * for verification. The Safaricom STK query is
         * authoritative for the resulting payment status.
         */
        if (
            provider === "mpesa" &&
            verification.verificationResult
        ) {
            normalized.status =
                verification
                    .verificationResult
                    .status;

            normalized.message =
                verification
                    .verificationResult
                    .message ||
                normalized.message;

            normalized.providerReference =
                verification
                    .verificationResult
                    .providerReference ||
                normalized.providerReference;

            normalized.providerTransactionId =
                verification
                    .verificationResult
                    .providerTransactionId ||
                normalized.providerTransactionId;

            normalized.providerResponse = {
                callback:
                    normalized.providerResponse,

                verification:
                    verification
                        .verificationResult
                        .providerResponse ||
                    null
            };
        }

        if (!normalized.eventId) {
            throw new Error(
                "Provider webhook event ID is missing."
            );
        }

        /*
         * Unsupported lifecycle events are safely recorded
         * but must never alter payment state.
         */
        if (
            normalized.status ===
            "ignored"
        ) {
            const result =
                await createWebhookEventSafely({
                    provider,
                    normalized,
                    payload
                });

            const event =
                result.event;

            return {
                duplicate:
                    !result.created,
                matched: false,
                event
            };
        }

        const result =
            await createWebhookEventSafely({
                provider,
                normalized,
                payload
            });

        let event =
            result.event;

        if (!result.created) {
            if (
                event.status ===
                "processed"
            ) {
                return {
                    duplicate: true,
                    event
                };
            }

            if (
                event.status ===
                "ignored"
            ) {
                return {
                    duplicate: true,
                    event
                };
            }

            const claim =
                await claimWebhookEvent({
                    provider,
                    eventId:
                        normalized.eventId
                });

            if (!claim) {
                return {
                    duplicate: true,
                    event
                };
            }

            event =
                claim.event;
        }

        try {
            const payment =
                await findPayment({
                    provider,
                    payload
                });

            if (!payment) {
                event.status =
                    "ignored";

                event.error =
                    "Payment could not be matched.";

                await event.save();

                return {
                    duplicate: false,
                    matched: false,
                    event
                };
            }

            const providerResult = {
                success:
                    normalized.status ===
                    "completed",

                provider,
                status:
                    normalized.status,

                message:
                    normalized.message,

                providerReference:
                    normalized.providerReference,

                providerTransactionId:
                    normalized.providerTransactionId,

                providerResponse:
                    normalized.providerResponse
            };

            const synchronized =
                await synchronizePaymentStatus({
                    payment,
                    providerResult
                });

            event.paymentReference =
                payment.reference;

            event.status =
                "processed";

            event.processedAt =
                new Date();

            await event.save();

            return {
                duplicate: false,
                matched: true,
                event,
                synchronized
            };
        } catch (error) {
            event.status =
                "failed";

            event.error =
                error.message;

            await event.save();

            throw error;
        }
    };

module.exports = {
    processProviderWebhook
};
