require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();

const authRoutes = require("./routes/auth.routes");
const businessRoutes = require("./routes/business.routes");
const paymentRoutes = require("./routes/payment.routes");
const apiKeyRoutes = require("./routes/apiKey.routes");
const transactionRoutes = require("./routes/transaction.routes");
const developerRoutes = require("./routes/developer.routes");
const developerPaymentRoutes = require("./routes/developer.payment.routes");
const webhookRoutes = require("./routes/webhook.routes");
const mpesaRoutes = require("./routes/mpesa.routes");
const customerRoutes = require("./routes/customer.routes");
const providerWebhookRoutes = require("./routes/providerWebhook.routes");
const providerConfigRoutes = require("./routes/providerConfig.routes");
const providerValidationRoutes = require("./routes/providerValidation.routes");



/*
 * Security configuration
 */

const allowedOrigins = (
    process.env.CORS_ORIGINS || "https://primepay-rho.vercel.app"
)
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        /*
         * Allow requests without an Origin header.
         * This includes curl, server-to-server requests,
         * provider callbacks and other non-browser clients.
         */
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.length === 0) {
            /*
             * No browser origins configured.
             * Reject cross-origin browser requests rather than
             * silently opening the API to every website.
             */
            return callback(
                new Error("CORS origin not allowed.")
            );
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(
            new Error("CORS origin not allowed.")
        );
    },
    methods: [
        "GET",
        "POST",
        "PATCH",
        "DELETE",
        "OPTIONS"
    ],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "X-API-Secret",
        "Idempotency-Key"
    ]
};

const globalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "Too many requests. Please try again later."
    }
});

const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
        success: false,
        message:
            "Too many authentication attempts. Please try again later."
    }
});

const apiRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message:
            "API request rate limit exceeded."
    }
});

/*
 * Core security middleware
 */

app.disable("x-powered-by");

app.use(helmet());

app.use(cors(corsOptions));

app.use(globalRateLimiter);

/*
 * Provider webhooks must receive the raw request body.
 * This route therefore remains BEFORE express.json().
 */
app.use(
    "/api/v1/provider-webhooks",
    providerWebhookRoutes
);

app.use(
    express.json({
        limit: "100kb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "50kb"
    })
);

app.use(morgan("dev"));

/*
 * Authentication endpoints receive a stricter limiter.
 */
app.use(
    "/api/v1/auth",
    authRateLimiter,
    authRoutes
);

/*
 * Developer API receives its own request limiter.
 */
app.use(
    "/api/v1/developer",
    apiRateLimiter,
    developerRoutes
);

app.use(
    "/api/v1/developer/payments",
    apiRateLimiter,
    developerPaymentRoutes
);

/*
 * Admin provider management
 */
app.use(
    "/api/v1/admin/providers",
    providerConfigRoutes
);

app.use(
    "/api/v1/admin/providers",
    providerValidationRoutes
);

/*
 * Authenticated application API
 */
app.use(
    "/api/v1/businesses",
    businessRoutes
);

app.use(
    "/api/v1/payments",
    paymentRoutes
);

app.use(
    "/api/v1/api-keys",
    apiKeyRoutes
);

app.use(
    "/api/v1/transactions",
    transactionRoutes
);

app.use(
    "/api/v1/webhooks",
    webhookRoutes
);

app.use(
    "/api/v1/mpesa",
    mpesaRoutes
);

app.use(
    "/api/v1/customers",
    customerRoutes
);

/*
 * Service information
 */

app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "PrimePay API",
        version: "v1"
    });
});

app.get("/api/v1/health", (req, res) => {
    res.json({
        success: true,
        service: "PrimePay API",
        status: "healthy",
        version: "v1"
    });
});

module.exports = app;
