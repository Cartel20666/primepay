const Business = require("../models/Business");
const Transaction = require("../models/Transaction");
const { getTransaction } = require("../services/payment.service");

const getTransactionByReference = async (req, res) => {
    try {
        const business = await Business.findOne({
            owner: req.user._id
        });

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "Business profile not found."
            });
        }

        const transaction = await getTransaction({
            businessId: business._id,
            reference: req.params.reference
        });

        res.json({
            success: true,
            transaction
        });
    } catch (error) {
        console.error("Transaction lookup error:", error);

        res.status(404).json({
            success: false,
            message: error.message || "Transaction not found."
        });
    }
};

const getMyTransactions = async (req, res) => {
    try {
        const business = await Business.findOne({
            owner: req.user._id
        });

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "Business profile not found."
            });
        }

        const page = Math.max(
            parseInt(req.query.page, 10) || 1,
            1
        );

        const limit = Math.min(
            Math.max(
                parseInt(req.query.limit, 10) || 20,
                1
            ),
            100
        );

        const skip = (page - 1) * limit;

        const filter = {
            business: business._id
        };

        if (req.query.status) {
            filter.status = req.query.status;
        }

        if (req.query.type) {
            filter.type = req.query.type;
        }

        const [transactions, total] = await Promise.all([
            Transaction.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            Transaction.countDocuments(filter)
        ]);

        res.json({
            success: true,
            transactions,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("Transaction list error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve transactions."
        });
    }
};

module.exports = {
    getTransactionByReference,
    getMyTransactions
};
