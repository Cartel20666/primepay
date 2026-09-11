const crypto = require("crypto");

const Payment = require("../models/Payment");

const {
    reconcilePayment
} = require("../services/paymentReconciliation.service");

const POLL_INTERVAL_MS =
    Number(
        process.env.PAYMENT_RECONCILIATION_INTERVAL_MS
    ) || 30000;

const LOCK_DURATION_MS =
    Number(
        process.env.PAYMENT_RECONCILIATION_LOCK_DURATION_MS
    ) || 60000;

const RETRY_DELAY_MS =
    Number(
        process.env.PAYMENT_RECONCILIATION_RETRY_DELAY_MS
    ) || 30000;

const MAX_ATTEMPTS =
    Number(
        process.env.PAYMENT_RECONCILIATION_MAX_ATTEMPTS
    ) || 20;

let workerTimer = null;
let processing = false;

const createLockToken = () =>
    crypto.randomUUID();

const claimNextPayment = async () => {
    const now = new Date();

    const lockedUntil =
        new Date(
            now.getTime() +
            LOCK_DURATION_MS
        );

    /*
     * Always reclaim expired processing leases first.
     *
     * This prevents an ordinary pending payment from
     * being selected ahead of a payment whose previous
     * worker lease expired.
     */
    const expiredLockToken =
        createLockToken();

    const expiredPayment =
        await Payment.findOneAndUpdate(
            {
                status: "processing",

                reconciliationStatus:
                    "processing",

                reconciliationLockUntil: {
                    $lte: now
                }
            },

            {
                $set: {
                    reconciliationStatus:
                        "processing",

                    reconciliationLockUntil:
                        lockedUntil,

                    reconciliationLockToken:
                        expiredLockToken,

                    lastReconciliationAt:
                        now
                },

                $inc: {
                    reconciliationAttempts: 1
                }
            },

            {
                sort: {
                    reconciliationLockUntil: 1,
                    createdAt: 1
                },

                returnDocument: "after"
            }
        );

    if (expiredPayment) {
        return expiredPayment;
    }

    /*
     * No expired lease exists.
     *
     * Claim the next due pending reconciliation.
     */
    const pendingLockToken =
        createLockToken();

    return Payment.findOneAndUpdate(
        {
            status: "processing",

            reconciliationStatus:
                "pending",

            $or: [
                {
                    nextReconciliationAt: {
                        $lte: now
                    }
                },

                {
                    nextReconciliationAt:
                        null
                }
            ]
        },

        {
            $set: {
                reconciliationStatus:
                    "processing",

                reconciliationLockUntil:
                    lockedUntil,

                reconciliationLockToken:
                    pendingLockToken,

                lastReconciliationAt:
                    now
            },

            $inc: {
                reconciliationAttempts: 1
            }
        },

        {
            sort: {
                nextReconciliationAt: 1,
                createdAt: 1
            },

            returnDocument: "after"
        }
    );
};

const releasePayment = async (
    payment,
    result
) => {
    const attempts =
        Number(
            payment.reconciliationAttempts
        ) || 0;

    const current =
        await Payment.findOne({
            _id: payment._id,
            reconciliationLockToken:
                payment.reconciliationLockToken
        });

    if (!current) {
        console.error(
            `Payment reconciliation lease lost: ${payment._id}`
        );

        return;
    }

    const resultStatus =
        result?.status || null;

    const resultError =
        result?.error ||
        result?.message ||
        result?.providerResult?.message ||
        null;

    /*
     * The provider may already have changed the
     * payment to a terminal state during reconciliation.
     */
    if (
        current.status !==
        "processing"
    ) {
        const updateResult =
            await Payment.updateOne(
                {
                    _id: payment._id,
                    reconciliationLockToken:
                        payment.reconciliationLockToken
                },
                {
                    $set: {
                        reconciliationStatus:
                            "resolved",

                        reconciliationLastStatus:
                            resultStatus ||
                            current.status,

                        reconciliationLastError:
                            null,

                        reconciliationLastErrorAt:
                            null,

                        reconciliationLockUntil:
                            null,

                        reconciliationLockToken:
                            null,

                        nextReconciliationAt:
                            null
                    }
                }
            );

        if (
            updateResult.modifiedCount !== 1
        ) {
            console.error(
                `Payment reconciliation release lease mismatch: ${payment._id}`
            );
        }

        return;
    }

    /*
     * Some reconciliation failures are permanent until
     * an operator fixes the underlying configuration/data.
     */
    const nonRetryableStatuses = [
        "provider_unregistered",
        "recovery_unsupported",
        "invalid_payment",
        "invalid_provider"
    ];

    if (
        result &&
        nonRetryableStatuses.includes(
            result.status
        )
    ) {
        const updateResult =
            await Payment.updateOne(
                {
                    _id: payment._id,
                    reconciliationLockToken:
                        payment.reconciliationLockToken
                },
                {
                    $set: {
                        reconciliationStatus:
                            "exhausted",

                        reconciliationLastStatus:
                            resultStatus,

                        reconciliationLastError:
                            resultError,

                        reconciliationLastErrorAt:
                            resultError
                                ? new Date()
                                : null,

                        nextReconciliationAt:
                            null,

                        reconciliationLockUntil:
                            null,

                        reconciliationLockToken:
                            null
                    }
                }
            );

        if (
            updateResult.modifiedCount !== 1
        ) {
            console.error(
                `Payment reconciliation release lease mismatch: ${payment._id}`
            );

            return;
        }

        console.error(
            `Payment reconciliation stopped: ${payment._id} (${result.status})`
        );

        return;
    }

    if (
        attempts >= MAX_ATTEMPTS
    ) {
        const updateResult =
            await Payment.updateOne(
                {
                    _id: payment._id,
                    reconciliationLockToken:
                        payment.reconciliationLockToken
                },
                {
                    $set: {
                        reconciliationStatus:
                            "exhausted",

                        reconciliationLastStatus:
                            resultStatus,

                        reconciliationLastError:
                            resultError,

                        reconciliationLastErrorAt:
                            resultError
                                ? new Date()
                                : null,

                        nextReconciliationAt:
                            null,

                        reconciliationLockUntil:
                            null,

                        reconciliationLockToken:
                            null
                    }
                }
            );

        if (
            updateResult.modifiedCount !== 1
        ) {
            console.error(
                `Payment reconciliation release lease mismatch: ${payment._id}`
            );

            return;
        }

        console.error(
            `Payment reconciliation exhausted: ${payment._id}`
        );

        return;
    }

    const retryAt =
        new Date(
            Date.now() +
            RETRY_DELAY_MS
        );

    const updateResult =
        await Payment.updateOne(
            {
                _id: payment._id,
                reconciliationLockToken:
                    payment.reconciliationLockToken
            },
            {
                $set: {
                    reconciliationStatus:
                        "pending",

                    reconciliationLastStatus:
                        resultStatus,

                    reconciliationLastError:
                        resultError,

                    reconciliationLastErrorAt:
                        resultError
                            ? new Date()
                            : null,

                    nextReconciliationAt:
                        retryAt,

                    reconciliationLockUntil:
                        null,

                    reconciliationLockToken:
                        null
                }
            }
        );

    if (
        updateResult.modifiedCount !== 1
    ) {
        console.error(
            `Payment reconciliation release lease mismatch: ${payment._id}`
        );
    }
};

const processOnePayment = async () => {
    const payment =
        await claimNextPayment();

    if (!payment) {
        return false;
    }

    try {
        const result =
            await reconcilePayment(
                payment._id.toString()
            );

        await releasePayment(
            payment,
            result
        );
    } catch (error) {
        console.error(
            "Payment reconciliation error:",
            error.message
        );

        await releasePayment(
            payment,
            {
                success: false,

                status:
                    "reconciliation_error",

                error:
                    error.message
            }
        );
    }

    return true;
};

const processReconciliationQueue =
    async () => {
        if (processing) {
            return;
        }

        processing = true;

        try {
            while (true) {
                const processed =
                    await processOnePayment();

                if (!processed) {
                    break;
                }
            }
        } catch (error) {
            console.error(
                "Payment reconciliation worker error:",
                error.message
            );
        } finally {
            processing = false;
        }
    };

const startPaymentReconciliationWorker =
    () => {
        if (workerTimer) {
            return;
        }

        console.log(
            "PrimePay payment reconciliation worker started"
        );

        processReconciliationQueue();

        workerTimer = setInterval(
            processReconciliationQueue,
            POLL_INTERVAL_MS
        );
    };

const stopPaymentReconciliationWorker =
    () => {
        if (!workerTimer) {
            return;
        }

        clearInterval(workerTimer);
        workerTimer = null;

        console.log(
            "PrimePay payment reconciliation worker stopped"
        );
    };

module.exports = {
    processReconciliationQueue,
    processOnePayment,
    startPaymentReconciliationWorker,
    stopPaymentReconciliationWorker,
    claimNextPayment
};
