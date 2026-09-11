const express = require("express");

const {
    getTransactionByReference,
    getMyTransactions
} = require("../controllers/transaction.controller");

const { protect } = require("../middleware/auth.middleware");

const router = express.Router();

router.get("/", protect, getMyTransactions);
router.get("/:reference", protect, getTransactionByReference);

module.exports = router;
