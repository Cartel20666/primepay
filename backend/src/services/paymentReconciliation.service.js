const mongoose = require("mongoose");

const Payment = require("../models/Payment");
const providerRegistry =
    require("../providers/provider.registry");

const {
    synchronizePaymentStatus
} = require("./paymentStatus.service");

const recoverPayment = async (
    paymentId
) => {
    if (!paymentId) {
        throw new Error(
            "Payment ID is required for reconciliation."
        );
    }

    if (
        !mongoose.Types.ObjectId.isValid(
            paymentId
        )
    ) {
        throw new Error(
            "Invalid payment ID."
        );
    }

    const payment =
        await Payment.findById(
            paymentId
        );

    if (!payment) {
        throw new Error(
            "Payment not found."
        );
    }

    let provider;

    try {
        provider =
            providerRegistry.getProvider(
                payment.provider
            );
    } catch (error) {
        console.error(
            `Payment reconciliation provider unavailable: ${payment.provider}`
        );

        return {
            success: false,
            status: "provider_unregistered",
            payment,
            providerResult: {
                success: false,
                provider:
                    payment.provider,
                status:
                    "provider_unregistered",
                message:
                    error.message
            }
        };
    }

    /*
     * First preference:
     * verify a known provider reference.
     *
     * Example:
     * M-Pesa CheckoutRequestID
     */
    const providerReference =
        payment.providerReference ||
        payment.checkoutRequestId ||
        payment.providerTransactionId;

    if (
        providerReference &&
        typeof provider.verifyPayment ===
            "function"
    ) {
        const verificationResult =
            await provider.verifyPayment(
                providerReference
            );

        if (!verificationResult) {
            return {
                success: false,
                status: "verification_empty",
                payment: payment
            };
        }

        if (
            verificationResult.status ===
                "not_configured"
        ) {
            return {
                success: false,
                status: "not_configured",
                payment: payment,
                providerResult:
                    verificationResult
            };
        }

        if (
            verificationResult.status ===
                "recovery_error"
        ) {
            return {
                success: false,
                status: "recovery_error",
                payment: payment,
                providerResult:
                    verificationResult
            };
        }

        const synchronized =
            await synchronizePaymentStatus({
                payment,
                providerResult:
                    verificationResult
            });

        return {
            success: true,
            status:
                synchronized.status,
            previousStatus:
                synchronized.previousStatus,
            payment:
                synchronized.payment,
            transaction:
                synchronized.transaction,
            providerResult:
                synchronized.providerResult
        };
    }

    /*
     * Second preference:
     * recover using the PrimePay reference.
     *
     * This requires explicit provider
     * recovery capability.
     */
    if (
        !provider.capabilities?.recovery
    ) {
        return {
            success: false,
            status: "recovery_unsupported",
            payment: payment
        };
    }

    if (
        typeof provider.findPaymentByReference !==
        "function"
    ) {
        return {
            success: false,
            status: "recovery_unsupported",
            payment: payment
        };
    }

    const recoveryResult =
        await provider.findPaymentByReference(
            payment.reference
        );

    if (!recoveryResult) {
        return {
            success: false,
            status: "recovery_empty",
            payment: payment
        };
    }

    if (
        recoveryResult.status ===
            "not_found"
    ) {
        return {
            success: false,
            status: "not_found",
            payment: payment,
            providerResult:
                recoveryResult
        };
    }

    if (
        recoveryResult.status ===
            "not_configured"
    ) {
        return {
            success: false,
            status: "not_configured",
            payment: payment,
            providerResult:
                recoveryResult
        };
    }

    if (
        recoveryResult.status ===
            "recovery_error"
    ) {
        return {
            success: false,
            status: "recovery_error",
            payment: payment,
            providerResult:
                recoveryResult
        };
    }

    const synchronized =
        await synchronizePaymentStatus({
            payment,
            providerResult:
                recoveryResult
        });

    return {
        success: true,
        status:
            synchronized.status,
        previousStatus:
            synchronized.previousStatus,
        payment:
            synchronized.payment,
        transaction:
            synchronized.transaction,
        providerResult:
            synchronized.providerResult
    };
};

const reconcilePayment =
    async (paymentId) => {
        return recoverPayment(
            paymentId
        );
    };

module.exports = {
    recoverPayment,
    reconcilePayment
};
