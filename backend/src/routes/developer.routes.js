const express = require("express");

const { authenticateApiKey } = require("../middleware/apiKey.middleware");

const router = express.Router();

router.get("/test", authenticateApiKey, (req, res) => {
    res.json({
        success: true,
        message: "API key authentication successful.",
        environment: req.apiKey.environment,
        businessId: req.business._id
    });
});

module.exports = router;
