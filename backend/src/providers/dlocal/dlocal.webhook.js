const crypto = require("crypto");

const {
    getDlocalCredentials
} = require("./dlocal.auth");

const verifyNotificationSignature = ({
    headers,
    rawBody
}) => {
    if (!headers) {
        throw new Error(
            "dLocal notification headers are required."
        );
    }

    if (
        rawBody === undefined ||
        rawBody === null
    ) {
        throw new Error(
            "dLocal notification body is required."
        );
    }

    const signature =
        headers["signature"] ||
        headers["Signature"] ||
        headers["authorization"] ||
        headers["Authorization"];

    if (!signature) {
        throw new Error(
            "dLocal notification signature is missing."
        );
    }

    const {
        login,
        secretKey
    } = getDlocalCredentials();

    const date =
        headers["x-date"] ||
        headers["X-Date"];

    if (!date) {
        throw new Error(
            "dLocal notification X-Date header is missing."
        );
    }

    const bodyString =
        typeof rawBody === "string"
            ? rawBody
            : JSON.stringify(rawBody);

    const expectedSignature =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(
                `${login}${date}${bodyString}`
            )
            .digest("hex");

    const normalizedSignature =
        String(signature)
            .replace(
                /^V2-HMAC-SHA256,\s*Signature:\s*/i,
                ""
            )
            .trim();

    const received =
        Buffer.from(
            normalizedSignature,
            "utf8"
        );

    const expected =
        Buffer.from(
            expectedSignature,
            "utf8"
        );

    if (
        received.length !==
        expected.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        received,
        expected
    );
};

module.exports = {
    verifyNotificationSignature
};
