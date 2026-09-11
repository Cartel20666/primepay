const crypto = require("crypto");

const verifyWebhookSignature = ({
    payload,
    signature,
    secret,
    tolerance = 300
}) => {
    if (!payload || !signature || !secret) {
        return false;
    }

    const match = signature.match(/^t=(\d+),v1=([a-f0-9]+)$/i);

    if (!match) {
        return false;
    }

    const timestamp = Number(match[1]);
    const receivedSignature = match[2];

    if (!Number.isFinite(timestamp)) {
        return false;
    }

    const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);

    if (age > tolerance) {
        return false;
    }

    const signedPayload = `${timestamp}.${payload}`;

    const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(signedPayload)
        .digest("hex");

    if (receivedSignature.length !== expectedSignature.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(receivedSignature, "utf8"),
        Buffer.from(expectedSignature, "utf8")
    );
};

module.exports = {
    verifyWebhookSignature
};
