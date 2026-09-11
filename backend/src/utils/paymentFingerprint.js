const crypto = require("crypto");

const normalizeValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === "string") {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value.map(normalizeValue);
    }

    if (typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                result[key] = normalizeValue(value[key]);
                return result;
            }, {});
    }

    return value;
};

const createPaymentFingerprint = ({
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
}) => {
    const normalizedAmount =
        Number(amount);

    const payload =
        normalizeValue({
            amount: normalizedAmount,
            currency:
                String(currency || "KES")
                    .trim()
                    .toUpperCase(),
            country:
                country
                    ? String(country)
                        .trim()
                        .toUpperCase()
                    : null,
            provider:
                String(provider || "")
                    .trim()
                    .toLowerCase(),
            paymentMethod:
                paymentMethod
                    ? String(paymentMethod)
                        .trim()
                        .toLowerCase()
                    : null,
            customerName:
                customerName
                    ? String(customerName).trim()
                    : null,
            customerEmail:
                customerEmail
                    ? String(customerEmail)
                        .trim()
                        .toLowerCase()
                    : null,
            customerPhone:
                customerPhone
                    ? String(customerPhone).trim()
                    : null,
            description:
                description
                    ? String(description).trim()
                    : null,
            metadata:
                metadata || {}
        });

    return crypto
        .createHash("sha256")
        .update(
            JSON.stringify(payload),
            "utf8"
        )
        .digest("hex");
};

module.exports = {
    createPaymentFingerprint
};
