const axios = require("axios");

const getMpesaAccessToken = async () => {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
        throw new Error("M-Pesa consumer credentials are not configured.");
    }

    const environment = process.env.MPESA_ENVIRONMENT || "sandbox";

    const baseUrl =
        environment === "production"
            ? "https://api.safaricom.co.ke"
            : "https://sandbox.safaricom.co.ke";

    const credentials = Buffer
        .from(`${consumerKey}:${consumerSecret}`)
        .toString("base64");

    const response = await axios.get(
        `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: {
                Authorization: `Basic ${credentials}`
            }
        }
    );

    return response.data.access_token;
};

module.exports = {
    getMpesaAccessToken
};
