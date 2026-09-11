require("dotenv").config();

process.env.FRONTEND_URL = "https://primepay-rho.vercel.app";

const mongoose = require("mongoose");

const app = require("./src/app");
const connectDatabase = require("./src/config.database");

const {
    startWebhookWorker,
    stopWebhookWorker
} = require("./src/workers/webhook.worker");

const {
    startPaymentReconciliationWorker,
    stopPaymentReconciliationWorker
} = require("./src/workers/paymentReconciliation.worker");

const PORT = process.env.PORT || 5001;

let server;
let shuttingDown = false;

async function startServer() {
    try {
        await connectDatabase();

        server = app.listen(
            PORT,
            () => {
                console.log(
                    `PrimePay API running on port ${PORT}`
                );

                startWebhookWorker();
                startPaymentReconciliationWorker();
            }
        );
    } catch (error) {
        console.error(
            "PrimePay startup failed:",
            error.message
        );

        process.exit(1);
    }
}

const shutdown = async signal => {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log(
        `${signal} received. Shutting down PrimePay...`
    );

    stopWebhookWorker();
    stopPaymentReconciliationWorker();

    try {
        if (server) {
            await new Promise(resolve => {
                server.close(resolve);
            });

            console.log(
                "PrimePay HTTP server closed"
            );
        }

        await mongoose.disconnect();

        console.log(
            "PrimePay MongoDB connection closed"
        );

        process.exit(0);
    } catch (error) {
        console.error(
            "PrimePay shutdown failed:",
            error.message
        );

        process.exit(1);
    }
};

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

startServer();
