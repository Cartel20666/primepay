const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const Transaction = require("../models/Transaction");
const LedgerEntry = require("../models/LedgerEntry");
const {
    createPrimePayFeeRevenue,
    createProviderCost
} = require("./platformLedger.service");
const {
    calculatePrimePayFee
} = require("./fee.service");

const {
    queueWebhookDeliveries
} = require("./webhook.service");

const STATUS_TRANSITIONS = {
    pending: [
        "pending",
        "processing",
        "completed",
        "failed",
        "cancelled"
    ],

    processing: [
        "processing",
        "completed",
        "failed",
        "cancelled"
    ],

    completed: [
        "completed",
        "refunded"
    ],

    failed: [
        "failed"
    ],

    cancelled: [
        "cancelled"
    ],

    refunded: [
        "refunded"
    ]
};

const normalizeStatus = (status) => {
    switch (
        String(status || "")
            .toLowerCase()
            .trim()
    ) {
        case "completed":
        case "succeeded":
        case "success":
        case "paid":
            return "completed";

        case "failed":
        case "rejected":
        case "declined":
            return "failed";

        case "cancelled":
        case "canceled":
        case "voided":
            return "cancelled";

        case "refunded":
            return "refunded";

        case "pending":
            return "pending";

        case "processing":
        case "authorized":
        case "in_review":
        case "approved":
            return "processing";

        default:
            throw new Error(
                `Unsupported payment status "${status}".`
            );
    }
};

const canTransition = (
    currentStatus,
    nextStatus
) => {
    const current =
        String(currentStatus || "pending")
            .toLowerCase()
            .trim();

    const next =
        String(nextStatus || "")
            .toLowerCase()
            .trim();

    return Boolean(
        STATUS_TRANSITIONS[current]?.includes(next)
    );
};

const requireLegalTransition = (
    currentStatus,
    nextStatus
) => {
    if (
        !canTransition(
            currentStatus,
            nextStatus
        )
    ) {
        throw new Error(
            `Illegal payment status transition: "${currentStatus}" -> "${nextStatus}".`
        );
    }

    return true;
};

const buildStatusQueryMetadata = ({
    providerResult,
    providerStatus,
    payment
}) => ({
    provider:
        providerResult.provider ||
        payment.provider,

    status:
        providerStatus,

    message:
        providerResult.message ||
        null,

    providerReference:
        providerResult.providerReference ||
        null,

    providerTransactionId:
        providerResult.providerTransactionId ||
        null,

    checkedAt:
        new Date().toISOString()
});

const createCompletionLedgerEntry = async ({
    payment,
    transaction,
    session
}) => {
    const reference =
        `LEDGER-CREDIT-${payment.reference}`;

    const existing =
        await LedgerEntry.findOne({
            reference
        }).session(session);

    if (existing) {
        return {
            created: false,
            entry: existing
        };
    }

    try {
        const [entry] =
            await LedgerEntry.create(
                [
                    {
                        business:
                            payment.business,

                        transaction:
                            transaction._id,

                        type:
                            "credit",

                        amount:
                            Number(payment.amount),

                        currency:
                            String(
                                payment.currency ||
                                "KES"
                            )
                                .trim()
                                .toUpperCase(),

                        description:
                            `Payment received: ${payment.reference}`,

                        reference
                    }
                ],
                { session }
            );

        return {
            created: true,
            entry
        };
    } catch (error) {
        if (error?.code === 11000) {
            const concurrentEntry =
                await LedgerEntry.findOne({
                    reference
                }).session(session);

            if (concurrentEntry) {
                return {
                    created: false,
                    entry: concurrentEntry
                };
            }
        }

        throw error;
    }
};

const createRefundLedgerEntry = async ({
    payment,
    transaction,
    session
}) => {
    const reference =
        `LEDGER-DEBIT-REFUND-${payment.reference}`;

    const existing =
        await LedgerEntry.findOne({
            reference
        }).session(session);

    if (existing) {
        return {
            created: false,
            entry: existing
        };
    }

    try {
        const [entry] =
            await LedgerEntry.create(
                [
                    {
                        business:
                            payment.business,

                        transaction:
                            transaction._id,

                        type:
                            "debit",

                        amount:
                            Number(payment.amount),

                        currency:
                            String(
                                payment.currency ||
                                "KES"
                            )
                                .trim()
                                .toUpperCase(),

                        description:
                            `Payment refund: ${payment.reference}`,

                        reference
                    }
                ],
                { session }
            );

        return {
            created: true,
            entry
        };
    } catch (error) {
        if (error?.code === 11000) {
            const concurrentEntry =
                await LedgerEntry.findOne({
                    reference
                }).session(session);

            if (concurrentEntry) {
                return {
                    created: false,
                    entry: concurrentEntry
                };
            }
        }

        throw error;
    }
};

const synchronizePaymentStatus = async ({
    payment,
    providerResult
}) => {
    if (!payment) {
        throw new Error(
            "Payment is required."
        );
    }

    if (!providerResult) {
        throw new Error(
            "Provider result is required."
        );
    }

    const providerStatus =
        normalizeStatus(
            providerResult.status
        );

    const session =
        await mongoose.startSession();

    let result;

    try {
        await session.withTransaction(
            async () => {
                /*
                 * Reload the payment inside the transaction.
                 * Never trust the caller's stale Mongoose document
                 * during concurrent status updates.
                 */
                const currentPayment =
                    await Payment.findById(
                        payment._id
                    ).session(session);

                if (!currentPayment) {
                    throw new Error(
                        "Payment not found."
                    );
                }

                const transaction =
                    await Transaction.findById(
                        currentPayment.transaction
                    ).session(session);

                if (!transaction) {
                    throw new Error(
                        "Payment transaction not found."
                    );
                }

                const previousPaymentStatus =
                    currentPayment.status;

                const previousTransactionStatus =
                    transaction.status;

                if (
                    previousPaymentStatus !==
                    previousTransactionStatus
                ) {
                    throw new Error(
                        "Payment and transaction statuses are inconsistent."
                    );
                }

                requireLegalTransition(
                    previousPaymentStatus,
                    providerStatus
                );

                /*
                 * If another concurrent request already completed
                 * the payment, the transition above will reject
                 * rather than silently rewriting completed state.
                 */
                currentPayment.status =
                    providerStatus;

                transaction.status =
                    providerStatus;

                if (
                    providerResult.providerReference
                ) {
                    currentPayment.providerReference =
                        providerResult.providerReference;

                    transaction.providerReference =
                        providerResult.providerReference;
                }

                if (
                    providerResult.providerTransactionId
                ) {
                    currentPayment.providerTransactionId =
                        providerResult.providerTransactionId;

                    transaction.providerTransactionId =
                        providerResult.providerTransactionId;
                }

                const statusQuery =
                    buildStatusQueryMetadata({
                        providerResult,
                        providerStatus,
                        payment: currentPayment
                    });

                currentPayment.metadata = {
                    ...(currentPayment.metadata || {}),
                    statusQuery
                };

                transaction.metadata = {
                    ...(transaction.metadata || {}),
                    statusQuery
                };

                await currentPayment.save({
                    session
                });

                await transaction.save({
                    session
                });

                /*
                 * Completion accounting occurs inside the SAME
                 * MongoDB transaction as the status update.
                 */
                if (
                    providerStatus ===
                        "completed" &&
                    previousPaymentStatus !==
                        "completed"
                ) {
                    /*
                     * Merchant gross-payment accounting.
                     */
                    await createCompletionLedgerEntry({
                        payment:
                            currentPayment,

                        transaction,

                        session
                    });

                    /*
                     * PrimePay platform revenue accounting.
                     *
                     * The fee configuration is resolved from the
                     * provider + payment currency. If no active
                     * configuration exists, the calculated fee is 0.
                     */
                    const feeResult =
                        await calculatePrimePayFee({
                            provider:
                                currentPayment.provider,

                            currency:
                                currentPayment.currency,

                            amount:
                                currentPayment.amount
                        });

                    /*
                     * Persist the exact financial breakdown on both
                     * payment and transaction records.
                     */
                    const providerFee =
                        Number(
                            currentPayment.providerFee
                        ) || 0;

                    const primePayFee =
                        Number(
                            feeResult.primePayFee
                        ) || 0;

                    const totalFee =
                        providerFee +
                        primePayFee;

                    currentPayment.primePayFee =
                        primePayFee;

                    currentPayment.providerFee =
                        providerFee;

                    currentPayment.totalFee =
                        totalFee;

                    currentPayment.fee =
                        totalFee;

                    currentPayment.netAmount =
                        feeResult.merchantNet;

                    currentPayment.metadata = {
                        ...(currentPayment.metadata || {}),

                        fee: {
                            configured:
                                feeResult.configured,

                            percentage:
                                feeResult.percentage,

                            fixedAmount:
                                feeResult.fixedAmount,

                            primePayFee:
                                primePayFee,

                            providerFee:
                                providerFee,

                            totalFee:
                                totalFee,

                            merchantNet:
                                feeResult.merchantNet,

                            feeBearer:
                                feeResult.feeBearer
                        }
                    };

                    transaction.primePayFee =
                        primePayFee;

                    transaction.providerFee =
                        providerFee;

                    transaction.totalFee =
                        totalFee;

                    transaction.fee =
                        totalFee;

                    transaction.netAmount =
                        feeResult.merchantNet;

                    transaction.metadata = {
                        ...(transaction.metadata || {}),

                        fee: {
                            configured:
                                feeResult.configured,

                            percentage:
                                feeResult.percentage,

                            fixedAmount:
                                feeResult.fixedAmount,

                            primePayFee:
                                primePayFee,

                            providerFee:
                                providerFee,

                            totalFee:
                                totalFee,

                            merchantNet:
                                feeResult.merchantNet,

                            feeBearer:
                                feeResult.feeBearer
                        }
                    };

                    await currentPayment.save({
                        session
                    });

                    await transaction.save({
                        session
                    });

                    /*
                     * Only create platform revenue when an actual
                     * PrimePay fee exists.
                     *
                     * The deterministic reference inside the
                     * platform ledger makes this operation
                     * concurrency-safe and exactly-once.
                     */
                    if (
                        feeResult.primePayFee > 0
                    ) {
                        await createPrimePayFeeRevenue({
                            transactionId:
                                transaction._id,

                            paymentId:
                                currentPayment._id,

                            paymentReference:
                                currentPayment.reference,

                            amount:
                                feeResult.primePayFee,

                            currency:
                                currentPayment.currency,

                            session
                        });
                    }

                    /*
                     * Provider fees are platform expenses.
                     *
                     * They are deliberately NOT deducted from
                     * merchantNet under the current fee policy.
                     *
                     * The deterministic provider-cost reference
                     * makes this operation concurrency-safe and
                     * exactly-once.
                     */
                    if (
                        providerFee > 0
                    ) {
                        await createProviderCost({
                            transactionId:
                                transaction._id,

                            paymentId:
                                currentPayment._id,

                            paymentReference:
                                currentPayment.reference,

                            amount:
                                providerFee,

                            currency:
                                currentPayment.currency,

                            session
                        });
                    }
                }


                  /*
                   * Refund accounting occurs inside the SAME
                   * MongoDB transaction as the completed -> refunded
                   * status transition.
                   *
                   * Only the merchant payment amount is reversed.
                   * PrimePay fees and provider costs are not reversed
                   * unless their actual recovery is confirmed.
                   */
                  if (
                      providerStatus ===
                          "refunded" &&
                      previousPaymentStatus ===
                          "completed"
                  ) {
                      await createRefundLedgerEntry({
                          payment:
                              currentPayment,

                          transaction,

                          session
                      });
                  }

                /*
                 * Queue the merchant webhook INSIDE the same
                 * MongoDB transaction as the payment/accounting
                 * state change.
                 *
                 * The queue record commits atomically with the
                 * payment and ledger changes. Actual HTTP delivery
                 * happens later in the webhook worker.
                 */
                let webhookEvent = null;

                if (
                    previousPaymentStatus !==
                    providerStatus
                ) {
                    if (
                        providerStatus ===
                        "completed"
                    ) {
                        webhookEvent =
                            "payment.completed";
                    } else if (
                        providerStatus ===
                        "failed"
                    ) {
                        webhookEvent =
                            "payment.failed";
                    } else if (
                        providerStatus ===
                        "cancelled"
                    ) {
                        webhookEvent =
                            "payment.cancelled";
                    } else if (
                        providerStatus ===
                        "refunded"
                    ) {
                        webhookEvent =
                            "payment.refunded";
                    }
                }

                if (webhookEvent) {
                    await queueWebhookDeliveries({
                        businessId:
                            currentPayment.business,

                        event:
                            webhookEvent,

                        data: {
                            payment:
                                currentPayment.toObject(),

                            transaction:
                                transaction.toObject(),

                            provider:
                                providerResult
                        },

                        session
                    });
                }

                result = {
                    payment:
                        currentPayment,

                    transaction,

                    providerResult,

                    previousStatus:
                        previousPaymentStatus,

                    status:
                        providerStatus
                };
            }
        );
    } finally {
        await session.endSession();
    }

    return result;
};

module.exports = {
    synchronizePaymentStatus,
    normalizeStatus,
    canTransition,
    requireLegalTransition,
    STATUS_TRANSITIONS
};
