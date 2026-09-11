const normalizeKenyanPhone = (phone) => {
    if (!phone) {
        throw new Error("Phone number is required.");
    }

    let value = String(phone).trim().replace(/\s+/g, "");

    if (value.startsWith("+254")) {
        value = value.slice(1);
    } else if (value.startsWith("07") || value.startsWith("01")) {
        value = `254${value.slice(1)}`;
    }

    if (!/^254(7|1)\d{8}$/.test(value)) {
        throw new Error("Invalid Kenyan phone number.");
    }

    return value;
};

module.exports = {
    normalizeKenyanPhone
};
