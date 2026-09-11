const Payment = require("../models/Payment");
const Business = require("../models/Business");

const getMyCustomers = async (req, res) => {
    try {
        const business = await Business.findOne({
            owner: req.user._id,
            suspended: false
        });

        if (!business) {
            return res.status(404).json({
                success: false,
                message: "Business profile not found."
            });
        }

        const search = (req.query.search || "").trim();

        const match = {
            business: business._id,
            $or: [
                { customerEmail: { $ne: null } },
                { customerPhone: { $ne: null } },
                { customerName: { $ne: null } }
            ]
        };

        if (search) {
            match.$and = [{
                $or: [
                    { customerName: { $regex: search, $options: "i" } },
                    { customerEmail: { $regex: search, $options: "i" } },
                    { customerPhone: { $regex: search, $options: "i" } }
                ]
            }];
        }

        const customers = await Payment.aggregate([
            { $match: match },
            {
                $group: {
                    _id: {
                        email: "$customerEmail",
                        phone: "$customerPhone"
                    },
                    customerName: { $last: "$customerName" },
                    customerEmail: { $last: "$customerEmail" },
                    customerPhone: { $last: "$customerPhone" },
                    paymentCount: { $sum: 1 },
                    totalAmount: { $sum: "$amount" },
                    currency: { $last: "$currency" },
                    lastPaymentAt: { $max: "$createdAt" }
                }
            },
            { $sort: { lastPaymentAt: -1 } },
            {
                $project: {
                    _id: 0,
                    customerName: 1,
                    customerEmail: 1,
                    customerPhone: 1,
                    paymentCount: 1,
                    totalAmount: 1,
                    currency: 1,
                    lastPaymentAt: 1
                }
            }
        ]);

        res.json({
            success: true,
            customers
        });

    } catch (error) {
        console.error("Customer listing error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to retrieve customers."
        });
    }
};

module.exports = {
    getMyCustomers
};
