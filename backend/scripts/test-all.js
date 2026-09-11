const { spawnSync } = require("child_process");

const tests = [
    "test-api-isolation.js",
    "test-api-security.js",
    "test-fee-accounting.js",
    "test-idempotency.js",
    "test-mpesa-adapter.js",
    "test-mpesa-callback.js",
    "test-mpesa-provider-webhook.js",
    "test-mpesa-verification-safety.js",
    "test-payment-api.js",
    "test-payment-completion.js",
    "test-payment-hardening.js",
    "test-payment-reconciliation.js",
    "test-payment-state-machine.js",
    "test-paypal-webhook.js",
    "test-provider-currency.js",
    "test-stripe-webhook.js",
    "test-webhook-integrity.js",
    "test-webhook-management.js",
    "test-webhook-outbox.js",
    "test-webhook-race.js",
    "test-webhook-retry.js",
    "test-api-key-lifecycle.js"
];

console.log("");
console.log("========================================");
console.log("        PRIMEPAY BACKEND TEST SUITE");
console.log("========================================");
console.log(`Tests: ${tests.length}`);
console.log("");

const startedAt = Date.now();

for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index];

    console.log(
        `[${index + 1}/${tests.length}] ${test}`
    );

    const result = spawnSync(
        process.execPath,
        [test],
        {
            stdio: "inherit",
            env: process.env
        }
    );

    if (result.error) {
        console.error(
            `\n✗ ${test} could not be started:`,
            result.error.message
        );

        process.exit(1);
    }

    if (result.status !== 0) {
        console.error("");
        console.error(
            `✗ Test suite stopped at ${test}`
        );
        console.error(
            `Exit code: ${result.status}`
        );

        process.exit(
            result.status || 1
        );
    }

    console.log(
        `✓ ${test} passed`
    );
    console.log("");
}

const duration =
    ((Date.now() - startedAt) / 1000).toFixed(2);

console.log("========================================");
console.log("       PRIMEPAY BACKEND TESTS PASSED");
console.log("========================================");
console.log(
    `✓ ${tests.length}/${tests.length} tests passed`
);
console.log(`✓ Completed in ${duration}s`);
console.log("");
