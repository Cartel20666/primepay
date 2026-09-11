const Payment = require("../models/Payment");
const providerRegistry = require("../providers/provider.registry");
const {
    synchronizePaymentStatus
} = require("../services/paymentStatus.service");

const handleStkCallback = async (req, res) => {
    try {
        const callback =
            req.body?.Body?.stkCallback;

        if (!callback) {
            return res.status(400).json({
                ResultCode: 1,
                ResultDesc:
                    "Invalid callback payload."
            });
        }

        const {
            ResultCode,
            ResultDesc,
            CheckoutRequestID,
            CallbackMetadata
        } = callback;

        if (!CheckoutRequestID) {
            return res.status(400).json({
                ResultCode: 1,
                ResultDesc:
                    "CheckoutRequestID is required."
            });
        }

        const metadata = {};

        if (
            Array.isArray(
                CallbackMetadata?.Item
            )
        ) {
            for (
                const item of CallbackMetadata.Item
            ) {
                if (item.Name) {
                    metadata[item.Name] =
                        item.Value ?? null;
                }
            }
        }

        const payment =
            await Payment.findOne({
                checkoutRequestId:
                    CheckoutRequestID
            });

        /*
         * Unknown callbacks are acknowledged.
         * Never create a payment from a provider callback.
         */
        if (!payment) {
            console.warn(
                "M-Pesa callback: payment not found",
                CheckoutRequestID
            );

            return res.json({
                ResultCode: 0,
                ResultDesc:
                    "Callback received."
            });
        }

        const provider =
            providerRegistry.getProvider(
                "mpesa"
            );

        /*
         * A successful callback is NOT trusted as the final
         * financial confirmation.
         *
         * Confirm it independently through Daraja STK Query.
         */
        let providerResult;

        if (Number(ResultCode) === 0) {
            providerResult =
                await provider.verifyPayment(
                    CheckoutRequestID
                );

            /*
             * If Daraja verification is uncertain,
             * acknowledge the callback but leave the
             * payment retryable.
             */
            if (
                providerResult.status ===
                "processing"
            ) {
                return res.json({
                    ResultCode: 0,
                    ResultDesc:
                        "Callback received. Payment verification is pending."
                });
            }

            if (
                providerResult.status ===
                    "not_configured" ||
                providerResult.status ===
                    "recovery_error"
            ) {
                return res.status(500).json({
                    ResultCode: 1,
                    ResultDesc:
                        "Payment verification could not be completed."
                });
            }
        } else {
            /*
             * A provider-declared failure does not need a
             * successful STK Query. The state machine will
             * prevent illegal downgrades.
             */
            providerResult = {
                success: false,
                provider: "mpesa",
                status: "failed",
                message:
                    ResultDesc ||
                    "M-Pesa payment failed.",
                providerReference:
                    CheckoutRequestID,
                providerTransactionId:
                    CheckoutRequestID,
                providerResponse: {
                    CheckoutRequestID,
                    ResultCode,
                    ResultDesc
                }
            };
        }

        /*
         * Preserve the original callback data alongside
         * the independently verified provider result.
         */
        const callbackData = {
            checkoutRequestId:
                CheckoutRequestID,
            resultCode:
                Number(ResultCode),
            resultDesc:
                ResultDesc || null,
            metadata,
            receivedAt:
                new Date().toISOString()
        };

        providerResult.providerResponse = {
            ...(providerResult.providerResponse ||
                {}),
            callback: callbackData
        };

        const synchronized =
            await synchronizePaymentStatus({
                payment,
                providerResult
            });

        /*
         * Store callback-specific metadata after the
         * state/accounting transaction has completed.
         */
        synchronized.payment.metadata = {
            ...(synchronized.payment.metadata ||
                {}),
            mpesaCallback:
                callbackData
        };

        synchronized.transaction.metadata = {
            ...(synchronized.transaction.metadata ||
                {}),
            mpesaCallback:
                callbackData
        };

        await synchronized.payment.save();
        await synchronized.transaction.save();

        return res.json({
            ResultCode: 0,
            ResultDesc:
                "Callback processed successfully."
        });
    } catch (error) {
        console.error(
            "M-Pesa callback error:",
            error
        );

        return res.status(500).json({
            ResultCode: 1,
            ResultDesc:
                "Callback processing failed."
        });
    }
};

module.exports = {
    handleStkCallback
};
