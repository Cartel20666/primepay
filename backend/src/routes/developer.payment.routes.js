const express = require("express");
const crypto = require("crypto");

const { createPayment } =
    require("../services/payment.service");

const {
    authenticateApiKey
} = require("../middleware/apiKey.middleware");

const router = express.Router();

const generateReference = () => {
    return `PP-${Date.now()}-${crypto
        .randomBytes(4)
        .toString("hex")
        .toUpperCase()}`;
};

router.post(
    "/",
    authenticateApiKey,
    async (req, res) => {
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

            if (
                normalizedIdempotencyKey.length > 255
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Idempotency-Key must not exceed 255 characters."
                });
            }

            const {
                amount,
                currency,
                provider,
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

            if (
                req.apiKey.environment !==
                "sandbox"
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Sandbox payment endpoint requires a sandbox API key."
                });
            }

            const result =
                await createPayment({
                    businessId:
                        req.business._id,
                    reference:
                        generateReference(),
                    idempotencyKey:
                        normalizedIdempotencyKey,
                    amount,
                    currency:
                        currency ||
                        req.business.currency ||
                        "KES",
                    provider,
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
                    payment:
                        result.payment,
                    transaction:
                        result.transaction,
                    provider:
                        result.providerResult,
                    idempotentReplay: true
                });
            }

            return res.status(201).json({
                success: true,
                message: "Payment created.",
                payment:
                    result.payment,
                transaction:
                    result.transaction,
                provider:
                    result.providerResult,
                idempotentReplay: false
            });
        } catch (error) {
            console.error(
                "Developer payment error:",
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
    }
);

module.exports = router;
