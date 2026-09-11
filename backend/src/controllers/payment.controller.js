const crypto = require("crypto");

const Payment = require("../models/Payment");
const Business = require("../models/Business");

const {
    createPayment: createPaymentService
} = require("../services/payment.service");

const {
    getProvider
} = require("../providers/provider.registry");

const {
    synchronizePaymentStatus
} = require("../services/paymentStatus.service");

const generateReference = () => {
    return `PP-${Date.now()}-${crypto
        .randomBytes(4)
        .toString("hex")
        .toUpperCase()}`;
};

const createPayment = async (req, res) => {
    try {
        const idempotencyKey =
            req.headers["idempotency-key"];

        if (
            !idempotencyKey ||
            typeof idempotencyKey !== "string" ||
            !idempotencyKey.trim()
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Idempotency-Key header is required."
            });
        }

        const normalizedIdempotencyKey =
            idempotencyKey.trim();

        if (normalizedIdempotencyKey.length > 255) {
            return res.status(400).json({
                success: false,
                message:
                    "Idempotency-Key must not exceed 255 characters."
            });
        }

        const {
            amount,
            currency,
            country,
            provider,
            paymentMethod,
            customerName,
            customerEmail,
            customerPhone,
            description,
            metadata
        } = req.body;

        if (!amount || amount < 1) {
            return res.status(400).json({
                success: false,
                message:
                    "A valid payment amount is required."
            });
        }

        if (!provider) {
            return res.status(400).json({
                success: false,
                message:
                    "Payment provider is required."
            });
        }

        const business =
            await Business.findOne({
                owner: req.user._id,
                suspended: false
            });

        if (!business) {
            return res.status(403).json({
                success: false,
                message:
                    "No active business profile found."
            });
        }

        const result =
            await createPaymentService({
                businessId: business._id,
                reference: generateReference(),
                idempotencyKey:
                    normalizedIdempotencyKey,
                amount,
                currency:
                    currency ||
                    business.currency ||
                    "KES",
                country,
                provider,
                paymentMethod,
                customerName,
                customerEmail,
                customerPhone,
                description,
                metadata
            });

        if (result.idempotentReplay) {
            return res.status(200).json({
                success: true,
                message:
                    "Existing payment returned.",
                payment: result.payment,
                transaction: result.transaction,
                provider: result.providerResult,
                idempotentReplay: true
            });
        }

        return res.status(201).json({
            success: true,
            message: "Payment created.",
            payment: result.payment,
            transaction: result.transaction,
            provider: result.providerResult,
            idempotentReplay: false
        });
    } catch (error) {
        console.error(
            "Payment creation error:",
            error.message
        );

        if (error?.code === "IDEMPOTENCY_CONFLICT") {
            return res.status(409).json({
                success: false,
                message: error.message,
                code: error.code
            });
        }

        const message =
            error.message ||
            "Unable to create payment.";

        if (
            message.includes(
                "not active or has not been validated"
            )
        ) {
            return res.status(403).json({
                success: false,
                message
            });
        }

        if (
            message ===
            "Active business profile not found."
        ) {
            return res.status(403).json({
                success: false,
                message
            });
        }

        return res.status(500).json({
            success: false,
            message:
                "Unable to create payment."
        });
    }
};

const getPayment = async (req, res) => {
    try {
        const business =
            await Business.findOne({
                owner: req.user._id
            });

        if (!business) {
            return res.status(404).json({
                success: false,
                message:
                    "Business profile not found."
            });
        }

        const payment =
            await Payment.findOne({
                reference:
                    req.params.reference,
                business: business._id
            });

        if (!payment) {
            return res.status(404).json({
                success: false,
                message:
                    "Payment not found."
            });
        }

        return res.json({
            success: true,
            payment
        });
    } catch (error) {
        console.error(
            "Payment lookup error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to retrieve payment."
        });
    }
};

const getPaymentStatus = async (req, res) => {
    try {
        const business =
            await Business.findOne({
                owner: req.user._id,
                suspended: false
            });

        if (!business) {
            return res.status(404).json({
                success: false,
                message:
                    "Business profile not found."
            });
        }

        const payment =
            await Payment.findOne({
                reference:
                    req.params.reference,
                business: business._id
            });

        if (!payment) {
            return res.status(404).json({
                success: false,
                message:
                    "Payment not found."
            });
        }

        if (!payment.providerReference) {
            return res.status(400).json({
                success: false,
                message:
                    "Provider transaction reference is not available for this payment."
            });
        }

        const provider =
            getProvider(
                payment.provider
            );

        const providerResult =
            await provider.verifyPayment(
                payment.providerReference
            );

        const synchronized =
            await synchronizePaymentStatus({
                payment,
                providerResult
            });

        return res.json({
            success: true,

            payment: {
                reference:
                    synchronized.payment
                        .reference,

                status:
                    synchronized.payment
                        .status,

                provider:
                    synchronized.payment
                        .provider,

                providerReference:
                    synchronized.payment
                        .providerReference,

                providerTransactionId:
                    synchronized.payment
                        .providerTransactionId
            },

            transaction: {
                reference:
                    synchronized.transaction
                        .reference,

                status:
                    synchronized.transaction
                        .status,

                providerReference:
                    synchronized.transaction
                        .providerReference,

                providerTransactionId:
                    synchronized.transaction
                        .providerTransactionId
            },

            provider:
                synchronized.providerResult
        });
    } catch (error) {
        console.error(
            "Payment status error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Unable to retrieve payment status."
        });
    }
};

module.exports = {
    createPayment,
    getPayment,
    getPaymentStatus
};
