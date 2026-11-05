import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Server } from 'node:http';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import ts from '@typescript/typescript6';
import { serve } from '@hono/node-server';
import { request } from '@playwright/test';
import { useSingleRequestConnections } from '../e2e/owned-http-listener.js';

type Fixture = (options: { e2eAuthPool: object; sellerConsoleEnabled: boolean }, use: (origin: string) => Promise<void>) => Promise<void>;
function timeouts(server: Server) {
    return { timeout: server.timeout, requestTimeout: server.requestTimeout, headersTimeout: server.headersTimeout,
        keepAliveTimeout: server.keepAliveTimeout, keepAliveTimeoutBuffer: server.keepAliveTimeoutBuffer };
}

// Run the actual fixture callback with its real Hono listener and connection policy.
// Only its DB/product/provider bootstrap is synthetic. This is not browser or domain acceptance.
function loadFixture(bootstrapError?: Error) {
    const pool = {}, sockets = new Set<unknown>();
    let server: Server | undefined, before: ReturnType<typeof timeouts> | undefined;
    let fixture: Fixture | undefined, arrivals = 0, dropped = 0, schemaCalls = 0;
    let configuredConsole: string | undefined;
    const received: { path: string; method: string; body: string; origin: string | null; csrf: string | null }[] = [];
    const respond = async (input: Request, provider = false) => {
        const entry = { path: new URL(input.url).pathname, method: input.method, body: await input.text(),
            origin: input.headers.get('origin'), csrf: input.headers.get('x-csrf-token') };
        received.push(entry);
        return Response.json({ provider, ...entry });
    };
    const dependencies: Record<string, unknown> = {
        'node:crypto': { randomBytes, randomUUID },
        '@hono/node-server': { serve: (options: Parameters<typeof serve>[0]) => {
            const listener = serve(options);
            assert.ok(listener instanceof Server);
            server = listener;
            before = timeouts(listener);
            listener.on('request', req => { arrivals++; sockets.add(req.socket); });
            listener.on('dropRequest', () => { dropped++; });
            return listener;
        } },
        '@hono/node-server/serve-static': { serveStatic: () => () => {} },
        './fixtures.js': { test: { extend: (definitions: { baseURL: Fixture }) => { fixture = definitions.baseURL; } } },
        '../../apps/platform-api/src/app.js': { createApp: () => {
            if (bootstrapError) throw bootstrapError;
            return { fetch: (input: Request) => respond(input), use() {}, get() {} };
        } },
        '../../modules/agent-commerce/payments/credentials.js': { CommerceCredentialKeyring: { parse: () => ({}) } },
        '../../modules/agent-commerce/operations/notifications/email-port.js': { FixtureEmailSender: class {} },
        '../../scripts/e2e-ecpay-fixture.js': { createE2eEcpayFixture: () => ({
            profiles: [], routes: { fetch: (input: Request) => respond(input, true) },
        }) },
        '../../modules/agent-commerce/operations/runtime-settings.js': { readCommerceSettings: (settings: Record<string, string>) => {
            configuredConsole = settings.FREEDOM_COMMERCE_CONSOLE_ENABLED;
            return settings;
        } },
        '../../packages/testing/e2e-admin.js': { e2eAuthorClaimAdminVerifier: {} },
        '../runtime/tenant-cursor-fixture.js': { TENANT_CURSOR_TEST_KEY: 'synthetic-unused' },
        './hosted-order-fixture.js': { ownedSchema: async (supplied: object) => { assert.equal(supplied, pool); schemaCalls++; } },
        './owned-http-listener.js': { useSingleRequestConnections },
    };
    const source = readFileSync(new URL('../e2e/seller-console-fixture.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    runInNewContext(compiled.outputText, { exports: {}, URL, Response, require: (id: string) => {
        assert.ok(Object.hasOwn(dependencies, id), `Unexpected fixture dependency: ${id}`);
        return dependencies[id];
    } }, { filename: 'seller-console-fixture.ts' });
    assert.ok(fixture);
    return {
        run: (use: (origin: string) => Promise<void>, enabled = true) => fixture!({ e2eAuthPool: pool, sellerConsoleEnabled: enabled }, use),
        listener: () => { assert.ok(server); return server; },
        before: () => before,
        counts: () => ({ arrivals, sockets: sockets.size, dropped }),
        bootstrap: () => ({ schemaCalls, configuredConsole }),
        received,
    };
}

for (const enabled of [true, false]) {
    test(`seller listener retires connections before use without changing deadlines or console=${enabled}`, { timeout: 15000 }, async () => {
        const f = loadFixture();
        await f.run(async origin => {
            assert.equal(f.listener().maxRequestsPerSocket, 1);
            assert.deepEqual(timeouts(f.listener()), f.before());
            assert.deepEqual(f.bootstrap(), { schemaCalls: 1, configuredConsole: String(enabled) });
            const client = await request.newContext({ baseURL: origin, timeout: 15000 });
            try {
                for (const path of ['/api/v1/tenants/synthetic/storefronts/synthetic/exception-cases', '/__e2e/ecpay/query', '/__e2e/commerce/query']) {
                    const response = await client.get(path, { maxRetries: 0 });
                    assert.equal(response.status(), 200);
                    assert.equal(response.headers().connection, 'close');
                    assert.equal((await response.json()).provider, path.startsWith('/__e2e/'));
                }
                assert.deepEqual(f.counts(), { arrivals: 3, sockets: 3, dropped: 0 });
            } finally { await client.dispose(); }
        }, enabled);
        assert.equal(f.listener().listening, false);
    });
}

test('seller login then exception GET across the idle boundary uses two connections and sends each request once', { timeout: 15000 }, async () => {
    const f = loadFixture();
    await f.run(async origin => {
        const client = await request.newContext({ baseURL: origin, timeout: 15000 });
        const body = { synthetic: true };
        try {
            const login = await client.post('/api/v1/auth/login', { data: body, maxRetries: 0,
                headers: { Origin: origin, 'X-CSRF-Token': 'synthetic-csrf' } });
            assert.equal(login.status(), 200);
            assert.equal(login.headers().connection, 'close');
            await login.body();
            await delay(6005);
            const path = '/api/v1/tenants/synthetic/storefronts/synthetic/exception-cases';
            const response = await client.get(path, { maxRetries: 0 });
            assert.equal(response.status(), 200);
            assert.equal(response.headers().connection, 'close');
            assert.equal((await response.json()).path, path);
            assert.deepEqual(f.received, [
                { path: '/api/v1/auth/login', method: 'POST', body: JSON.stringify(body), origin, csrf: 'synthetic-csrf' },
                { path, method: 'GET', body: '', origin: null, csrf: null },
            ]);
            assert.deepEqual(f.counts(), { arrivals: 2, sockets: 2, dropped: 0 });
        } finally { await client.dispose(); }
    });
    assert.equal(f.listener().listening, false);
});

test('seller parallel GETs retain all responses without drops or retries', { timeout: 15000 }, async () => {
    const f = loadFixture();
    await f.run(async origin => {
        const client = await request.newContext({ baseURL: origin, timeout: 15000 });
        try {
            const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => client.get(`/synthetic/${i}`, { maxRetries: 0 })));
            for (const [i, response] of responses.entries()) {
                assert.equal(response.status(), 200);
                assert.equal(response.headers().connection, 'close');
                assert.equal((await response.json()).path, `/synthetic/${i}`);
            }
            assert.deepEqual(f.counts(), { arrivals: 8, sockets: 8, dropped: 0 });
        } finally { await client.dispose(); }
    });
    assert.equal(f.listener().listening, false);
});

for (const stage of ['bootstrap', 'use']) {
    test(`seller listener cleanup preserves the original ${stage} failure`, { timeout: 15000 }, async () => {
        const error = new Error(`synthetic ${stage} failure`);
        const f = loadFixture(stage === 'bootstrap' ? error : undefined);
        let used = false;
        await assert.rejects(f.run(async () => { used = true; throw error; }), failure => failure === error);
        assert.equal(used, stage === 'use');
        assert.equal(f.listener().listening, false);
        assert.deepEqual(timeouts(f.listener()), f.before());
        assert.deepEqual(f.counts(), { arrivals: 0, sockets: 0, dropped: 0 });
    });
}

test('seller listener installs the imported policy first inside cleanup protection, before readiness awaits', { timeout: 15000 }, () => {
    const source = ts.createSourceFile('fixture.ts', readFileSync(new URL('../e2e/seller-console-fixture.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let fixture: ts.ArrowFunction | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'baseURL' && ts.isArrowFunction(node.initializer)) {
            assert.equal(fixture, undefined, 'There must be exactly one owned baseURL fixture.');
            fixture = node.initializer;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(fixture && ts.isBlock(fixture.body));
    const setup = fixture.body.statements.find((s): s is ts.TryStatement => ts.isTryStatement(s));
    assert.ok(setup?.finallyBlock);
    const first = setup.tryBlock.statements[0];
    assert.ok(ts.isExpressionStatement(first) && ts.isCallExpression(first.expression));
    assert.equal(first.expression.expression.getText(source), 'useSingleRequestConnections');
    assert.deepEqual(first.expression.arguments.map(a => a.getText(source)), ['server']);
    const imported = source.statements.find(s => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === './owned-http-listener.js');
    assert.ok(imported && ts.isImportDeclaration(imported));
    const bindings = imported.importClause?.namedBindings;
    assert.ok(bindings && ts.isNamedImports(bindings));
    assert.ok(bindings.elements.some(binding => binding.name.text === 'useSingleRequestConnections' && (binding.propertyName?.text ?? binding.name.text) === 'useSingleRequestConnections'));
});
