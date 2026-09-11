const express = require("express");

const {
    createBusiness,
    getMyBusiness,
    getMyBalance
} = require("../controllers/business.controller");

const { protect } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/", protect, createBusiness);
router.get("/me", protect, getMyBusiness);
router.get("/balance", protect, getMyBalance);

module.exports = router;
