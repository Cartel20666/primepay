const axios = require("axios");

const getPayPalBaseUrl = () => {
    return process.env.PAYPAL_ENVIRONMENT === "production"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";
};

const getAccessToken = async () => {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error(
            "PayPal client credentials are not configured."
        );
    }

    const credentials = Buffer
        .from(`${clientId}:${clientSecret}`)
        .toString("base64");

    const response = await axios.post(
        `${getPayPalBaseUrl()}/v1/oauth2/token`,
        "grant_type=client_credentials",
        {
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        }
    );

    return response.data.access_token;
};

const verifyWebhookSignature = async ({
    headers,
    webhookEvent
}) => {
    if (!headers) {
        throw new Error("PayPal webhook headers are required.");
    }

    if (!webhookEvent) {
        throw new Error("PayPal webhook event is required.");
    }

    const transmissionId =
        headers["paypal-transmission-id"];

    const transmissionTime =
        headers["paypal-transmission-time"];

    const certUrl =
        headers["paypal-cert-url"];

    const transmissionSig =
        headers["paypal-transmission-sig"];

    const authAlgo =
        headers["paypal-auth-algo"];

    const webhookId =
        process.env.PAYPAL_WEBHOOK_ID;

    if (
        !transmissionId ||
        !transmissionTime ||
        !certUrl ||
        !transmissionSig ||
        !authAlgo
    ) {
        throw new Error(
            "Required PayPal webhook signature headers are missing."
        );
    }

    if (!webhookId) {
        throw new Error(
            "PayPal webhook ID is not configured."
        );
    }

    const accessToken = await getAccessToken();

    const response = await axios.post(
        `${getPayPalBaseUrl()}/v1/notifications/verify-webhook-signature`,
        {
            auth_algo: authAlgo,
            cert_url: certUrl,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime,
            webhook_id: webhookId,
            webhook_event: webhookEvent
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        }
    );

    return {
        verified:
            response.data.verification_status === "SUCCESS",
        status:
            response.data.verification_status
    };
};

module.exports = {
    verifyWebhookSignature
};
