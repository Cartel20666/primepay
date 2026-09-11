const {
    processProviderWebhook
} = require("../services/providerWebhook.service");

const SUPPORTED_PROVIDERS = [
    "mpesa",
    "stripe",
    "paypal",
    "dlocal"
];

const receiveProviderWebhook =
    async (req, res) => {
        const provider =
            String(
                req.params.provider || ""
            )
                .toLowerCase()
                .trim();

        if (
            !SUPPORTED_PROVIDERS.includes(
                provider
            )
        ) {
            return res.status(404).json({
                success: false,
                message:
                    "Unsupported payment provider."
            });
        }

        try {
            const result =
                await processProviderWebhook({
                    provider,
                    headers:
                        req.headers,
                    rawBody:
                        req.body
                });

            if (result.duplicate) {
                return res.status(200).json({
                    success: true,
                    message:
                        "Webhook already processed.",
                    duplicate: true
                });
            }

            if (!result.matched) {
                return res.status(200).json({
                    success: true,
                    message:
                        "Webhook received but no matching payment was found.",
                    matched: false
                });
            }

            return res.status(200).json({
                success: true,
                message:
                    "Webhook processed successfully.",
                matched: true,
                payment:
                    result.synchronized
                        .payment,
                transaction:
                    result.synchronized
                        .transaction
            });
        } catch (error) {
            console.error(
                `Provider webhook error [${provider}]:`,
                error
            );

            return res.status(400).json({
                success: false,
                message:
                    error.message ||
                    "Unable to process provider webhook."
            });
        }
    };

module.exports = {
    receiveProviderWebhook
};
