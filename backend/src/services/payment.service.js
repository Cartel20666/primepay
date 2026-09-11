const Payment = require("../models/Payment");
const Business = require("../models/Business");
const Transaction = require("../models/Transaction");

const { getProvider } =
    require("../providers/provider.registry");

const {
    requireCapability,
    requireCurrency
} = require("../providers/provider.interface");

const {
    isProviderActive
} = require("./providerConfig.service");

const {
    triggerWebhook
} = require("./webhook.service");

const {
    createPaymentFingerprint
} = require("../utils/paymentFingerprint");

const {
    normalizeStatus
} = require("./paymentStatus.service");

const {
    validatePaymentInput
} = require("../utils/paymentValidation");

const {
    IdempotencyConflictError
} = require("../errors/idempotency.error");

const createPayment = async ({
    businessId,
    amount,
    currency,
    country,
    provider,
    paymentMethod,
    customerName,
    customerEmail,
    customerPhone,
    description,
    metadata,
    reference,
    idempotencyKey
}) => {
    if (!businessId) {
        throw new Error("Business ID is required.");
    }

    const normalizedInput =
        validatePaymentInput({
            amount,
            currency,
            provider
        });

    const normalizedAmount =
        normalizedInput.amount;

    const normalizedProvider =
        normalizedInput.provider;

    const normalizedRequestedCurrency =
        normalizedInput.currency;

    if (
        !idempotencyKey ||
        typeof idempotencyKey !== "string" ||
        !idempotencyKey.trim()
    ) {
        throw new Error("Idempotency key is required.");
    }

    const normalizedIdempotencyKey =
        idempotencyKey.trim();

    const normalizedCountry =
        country
            ? String(country)
                .trim()
                .toUpperCase()
            : null;

    const requestFingerprint =
        createPaymentFingerprint({
            amount: normalizedAmount,
            currency:
                normalizedRequestedCurrency ||
                "KES",
            country: normalizedCountry,
            provider: normalizedProvider,
            paymentMethod,
            customerName,
            customerEmail,
            customerPhone,
            description,
            metadata
        });

    const business =
        await Business.findOne({
            _id: businessId,
            suspended: false
        });

    if (!business) {
        throw new Error(
            "Active business profile not found."
        );
    }

    const paymentProvider =
        getProvider(normalizedProvider);

    const active =
        await isProviderActive(
            normalizedProvider
        );

    if (!active) {
        throw new Error(
            `Payment provider "${normalizedProvider}" is not active or has not been validated.`
        );
    }

    requireCapability(
        paymentProvider,
        "payments"
    );

    const normalizedCurrency = (
        normalizedRequestedCurrency ||
        business.currency ||
        "KES"
    ).toUpperCase();

    requireCurrency(
        paymentProvider,
        normalizedCurrency
    );

    /*
     * Idempotency is enforced at the service layer.
     * Controllers must not duplicate this business logic.
     */
    const existingPayment =
        await Payment.findOne({
            business: business._id,
            idempotencyKey:
                normalizedIdempotencyKey
        });

    if (existingPayment) {
        if (
            existingPayment.requestFingerprint &&
            existingPayment.requestFingerprint !==
                requestFingerprint
        ) {
            throw new IdempotencyConflictError();
        }

        const existingTransaction =
            existingPayment.transaction
                ? await Transaction.findById(
                    existingPayment.transaction
                )
                : null;

        return {
            payment: existingPayment,
            transaction:
                existingTransaction,
            providerResult: null,
            idempotentReplay: true
        };
    }

    const transaction =
        await Transaction.create({
            business: business._id,
            type: "payment",
            reference,
            provider: normalizedProvider,
            amount: normalizedAmount,
            currency: normalizedCurrency,
            country: normalizedCountry,
            paymentMethod:
                paymentMethod || null,
            status: "pending",
            metadata: metadata || {}
        });

    let payment;

    try {
        payment =
            await Payment.create({
                business: business._id,
                transaction:
                    transaction._id,
                reference,
                idempotencyKey:
                    normalizedIdempotencyKey,
                requestFingerprint,
                amount: normalizedAmount,
                currency:
                    normalizedCurrency,
                country:
                    normalizedCountry,
                paymentMethod:
                    paymentMethod || null,
                provider:
                    normalizedProvider,
                customerName:
                    customerName || null,
                customerEmail:
                    customerEmail || null,
                customerPhone:
                    customerPhone || null,
                description:
                    description || null,
                metadata:
                    metadata || {},
                status: "pending"
            });
    } catch (error) {
        if (error?.code === 11000) {
            const existingPayment =
                await Payment.findOne({
                    business: business._id,
                    idempotencyKey:
                        normalizedIdempotencyKey
                });

            if (existingPayment) {
                if (
                    existingPayment.requestFingerprint &&
                    existingPayment.requestFingerprint !==
                        requestFingerprint
                ) {
                    await Transaction.deleteOne({
                        _id: transaction._id
                    });

                    throw new IdempotencyConflictError();
                }

                await Transaction.deleteOne({
                    _id: transaction._id
                });

                return {
                    payment: existingPayment,
                    transaction:
                        existingPayment.transaction
                            ? await Transaction.findById(
                                existingPayment.transaction
                            )
                            : null,
                    providerResult: null,
                    idempotentReplay: true
                };
            }
        }

        await Transaction.deleteOne({
            _id: transaction._id
        });

        throw error;
    }

    let providerResult;

    try {
        providerResult =
            await paymentProvider.initiatePayment({
                amount: normalizedAmount,
                currency:
                    normalizedCurrency,
                country:
                    normalizedCountry,
                paymentMethod:
                    paymentMethod || null,
                reference,
                customerName,
                customerEmail,
                customerPhone,
                description,
                metadata
            });
    } catch (error) {
        providerResult = {
            success: false,
            provider:
                normalizedProvider,
            status:
                error.uncertainOutcome
                    ? "processing"
                    : "failed",
            message:
                error.message,
            paymentReference:
                reference,
            uncertainOutcome:
                Boolean(
                    error.uncertainOutcome
                ),
            providerResponded:
                Boolean(
                    error.providerResponded
                ),
            providerResponse:
                error.providerResponse ||
                null,
            statusCode:
                error.statusCode ||
                null
        };
    }

    if (!providerResult?.success) {
        payment.status =
            providerResult?.status ===
            "cancelled"
                ? "cancelled"
                : providerResult?.status ===
                    "processing"
                    ? "processing"
                    : "failed";

        transaction.status =
            payment.status;

        if (payment.status === "processing") {
            payment.reconciliationStatus =
                "pending";

            payment.reconciliationAttempts =
                0;

            payment.nextReconciliationAt =
                new Date();

            payment.lastReconciliationAt =
                null;

            payment.reconciliationLockUntil =
                null;

            payment.reconciliationLockToken =
                null;
        }

        payment.metadata = {
            ...(payment.metadata || {}),
            providerStatus:
                providerResult?.status ||
                "failed",
            providerMessage:
                providerResult?.message ||
                null
        };

        transaction.metadata = {
            ...(transaction.metadata || {}),
            providerStatus:
                providerResult?.status ||
                "failed",
            providerMessage:
                providerResult?.message ||
                null
        };

        await payment.save();
        await transaction.save();

        await triggerWebhook(
            business._id,
            "payment.created",
            {
                payment:
                    payment.toObject(),
                transaction:
                    transaction.toObject()
            }
        );

        return {
            payment,
            transaction,
            providerResult,
            idempotentReplay: false
        };
    }

    const normalizedProviderStatus =
        normalizeStatus(
            providerResult.status
        );

    payment.status =
        normalizedProviderStatus;

    transaction.status =
        normalizedProviderStatus;

    if (
        normalizedProviderStatus ===
        "processing"
    ) {
        payment.reconciliationStatus =
            "pending";

        payment.reconciliationAttempts =
            0;

        payment.nextReconciliationAt =
            new Date();

        payment.lastReconciliationAt =
            null;

        payment.reconciliationLockUntil =
            null;

        payment.reconciliationLockToken =
            null;
    }

    transaction.providerTransactionId =
        providerResult.providerTransactionId ||
        null;

    transaction.providerReference =
        providerResult.providerReference ||
        null;

    transaction.providerFee =
        Number(providerResult.fee) || 0;

    transaction.totalFee =
        transaction.providerFee;

    transaction.fee =
        transaction.totalFee;

    transaction.netAmount =
        providerResult.netAmount !== undefined &&
        providerResult.netAmount !== null
            ? Number(providerResult.netAmount)
            : Math.max(
                normalizedAmount -
                transaction.totalFee,
                0
            );

    transaction.settlementCurrency =
        providerResult.settlementCurrency ||
        normalizedCurrency;

    transaction.exchangeRate =
        providerResult.exchangeRate !== undefined &&
        providerResult.exchangeRate !== null
            ? Number(providerResult.exchangeRate)
            : null;

    payment.providerTransactionId =
        providerResult.providerTransactionId ||
        null;

    payment.providerReference =
        providerResult.providerReference ||
        null;

    payment.providerFee =
        Number(providerResult.fee) || 0;

    payment.totalFee =
        payment.providerFee;

    payment.fee =
        payment.totalFee;

    payment.netAmount =
        providerResult.netAmount !== undefined &&
        providerResult.netAmount !== null
            ? Number(providerResult.netAmount)
            : Math.max(
                normalizedAmount -
                payment.totalFee,
                0
            );

    payment.settlementCurrency =
        providerResult.settlementCurrency ||
        normalizedCurrency;

    payment.exchangeRate =
        providerResult.exchangeRate !== undefined &&
        providerResult.exchangeRate !== null
            ? Number(providerResult.exchangeRate)
            : null;

    payment.checkoutRequestId =
        providerResult.checkoutRequestId ||
        null;

    payment.merchantRequestId =
        providerResult.merchantRequestId ||
        null;

    payment.metadata = {
        ...(payment.metadata || {}),
        providerStatus:
            providerResult.status ||
            null,
        providerMessage:
            providerResult.message ||
            null
    };

    transaction.metadata = {
        ...(transaction.metadata || {}),
        providerStatus:
            providerResult.status ||
            null,
        providerMessage:
            providerResult.message ||
            null
    };

    await payment.save();
    await transaction.save();

    await triggerWebhook(
        business._id,
        "payment.created",
        {
            payment:
                payment.toObject(),
            transaction:
                transaction.toObject()
        }
    );

    return {
        payment,
        transaction,
        providerResult,
        idempotentReplay: false
    };
};

module.exports = {
    createPayment
};
