import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from '@typescript/typescript6';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { createServer as createHttp2Server } from 'node:http2';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from '@hono/node-server';
import { request, type APIRequestContext } from '@playwright/test';
import { useSingleRequestConnections } from '../e2e/owned-http-listener.js';
function timeouts(server: Server) {
    return { timeout: server.timeout, requestTimeout: server.requestTimeout, headersTimeout: server.headersTimeout,
        keepAliveTimeout: server.keepAliveTimeout, keepAliveTimeoutBuffer: server.keepAliveTimeoutBuffer };
}
async function fixture(handler?: (req: IncomingMessage, res: ServerResponse) => void) {
    const server = handler ? createServer(handler) : serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ ok: true }) });
    assert.ok(server instanceof Server);
    let context: APIRequestContext | undefined;
    const close = async () => {
        try {
            await context?.dispose();
        }
        finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => {
                if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING')
                    reject(error);
                else
                    resolve();
            }));
        }
    };
    try {
        const before = timeouts(server);
        useSingleRequestConnections(server);
        assert.deepEqual(timeouts(server), before);
        const sockets = new Set<unknown>();
        let arrivals = 0, dropped = 0;
        server.on('request', req => { arrivals++; sockets.add(req.socket); });
        server.on('dropRequest', () => { dropped++; });
        if (handler)
            server.listen(0, '127.0.0.1');
        if (!server.listening)
            await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const origin = `http://127.0.0.1:${address.port}`;
        context = await request.newContext({ baseURL: origin, timeout: 10000 });
        return { server, origin, context, counts: () => ({ arrivals, sockets: sockets.size, dropped }), close };
    }
    catch (error) {
        await close();
        throw error;
    }
}
async function cookieNames(context: APIRequestContext) {
    return (await context.storageState()).cookies.map(c => [c.name, c.value, c.domain, c.path]).sort();
}
test('owned listener policy rejects an unexpected protocol instead of silently leaving pooling enabled', { timeout: 15000 }, () => {
    for (const value of [undefined, null, {}, { maxRequestsPerSocket: 0 }, createHttp2Server()])
        assert.throws(() => useSingleRequestConnections(value), /HTTP\/1/);
});
test('owned listener policy changes only the per-connection request limit', { timeout: 15000 }, () => {
    const server = createServer();
    const before = timeouts(server);
    useSingleRequestConnections(server);
    assert.equal(server.maxRequestsPerSocket, 1);
    assert.deepEqual(timeouts(server), before);
});
test('sequential API requests retain their responses and use separate connections', { timeout: 15000 }, async () => {
    const f = await fixture();
    try {
        for (let i = 0; i < 4; i++) {
            const response = await f.context.post('/synthetic', { data: { sequence: i }, maxRetries: 0 });
            assert.equal(response.status(), 200);
            assert.equal(response.headers().connection, 'close');
            assert.deepEqual(await response.json(), { ok: true });
        }
        assert.deepEqual(f.counts(), { arrivals: 4, sockets: 4, dropped: 0 });
    }
    finally {
        await f.close();
    }
});
test('ordinary parallel API requests are not dropped or replayed', { timeout: 15000 }, async () => {
    const f = await fixture();
    try {
        const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => f.context.post('/synthetic', { data: { sequence: i }, maxRetries: 0 })));
        for (const response of responses) {
            assert.equal(response.status(), 200);
            assert.equal(response.headers().connection, 'close');
            await response.body();
        }
        assert.deepEqual(f.counts(), { arrivals: 8, sockets: 8, dropped: 0 });
    }
    finally {
        await f.close();
    }
});
test('an idle gap around the default server boundary cannot reuse the earlier fixture connection', { timeout: 15000 }, async () => {
    const f = await fixture();
    try {
        await (await f.context.post('/first', { data: { synthetic: true }, maxRetries: 0 })).body();
        await delay(6005);
        const response = await f.context.post('/second', { data: { synthetic: true }, maxRetries: 0 });
        assert.equal(response.status(), 200);
        assert.equal(response.headers().connection, 'close');
        assert.deepEqual(f.counts(), { arrivals: 2, sockets: 2, dropped: 0 });
    }
    finally {
        await f.close();
    }
});
for (const status of [200, 503])
    test(`native API cookie replacement/deletion and unrelated scope remain intact for HTTP ${status}`, { timeout: 15000 }, async () => {
        let sentCookie = '';
        const f = await fixture((req, res) => {
            sentCookie = req.headers.cookie ?? '';
            req.resume();
            res.writeHead(status, { 'Content-Type': 'application/json', 'Set-Cookie': [
                    'freedom_local_session=new-synthetic; Path=/; HttpOnly; SameSite=Strict',
                    'freedom_google_flow=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
                ] });
            res.end(JSON.stringify({ ok: status === 200 }));
        });
        let context: APIRequestContext | undefined;
        try {
            context = await request.newContext({ baseURL: f.origin, timeout: 10000, storageState: { cookies: [
                        { name: 'freedom_local_session', value: 'old-synthetic', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' },
                        { name: 'freedom_google_flow', value: 'pending-synthetic', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' },
                        { name: 'unrelated', value: 'keep-root', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
                        { name: 'freedom_local_session', value: 'keep-path', domain: '127.0.0.1', path: '/other', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' },
                        { name: 'freedom_local_session', value: 'keep-domain', domain: 'localhost', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' },
                    ], origins: [] } });
            const response = await context.post('/api/v1/auth/login', { data: { synthetic: true }, maxRetries: 0 });
            assert.equal(response.status(), status);
            assert.equal(response.headers().connection, 'close');
            assert.match(sentCookie, /freedom_local_session=old-synthetic/);
            assert.match(sentCookie, /freedom_google_flow=pending-synthetic/);
            assert.doesNotMatch(sentCookie, /keep-path|keep-domain/);
            assert.deepEqual(await cookieNames(context), [
                ['freedom_local_session', 'keep-domain', 'localhost', '/'],
                ['freedom_local_session', 'keep-path', '127.0.0.1', '/other'],
                ['freedom_local_session', 'new-synthetic', '127.0.0.1', '/'],
                ['unrelated', 'keep-root', '127.0.0.1', '/'],
            ].sort());
            assert.deepEqual(f.counts(), { arrivals: 1, sockets: 1, dropped: 0 });
        }
        finally {
            try {await context?.dispose();}
            finally {await f.close();}
        }
    });
test('invalid JSON fails without undoing received Set-Cookie or replaying POST', { timeout: 15000 }, async () => {
    const f = await fixture((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'synthetic=received; Path=/' }); res.end('{'); });
    try {
        const response = await f.context.post('/synthetic', { data: { synthetic: true }, maxRetries: 0 });
        await assert.rejects(response.json());
        assert.equal((await f.context.storageState()).cookies[0]?.value, 'received');
        assert.equal(f.counts().arrivals, 1);
    }
    finally {
        await f.close();
    }
});
test('truncated body still preserves received Set-Cookie and rejects without replay', { timeout: 15000 }, async () => {
    const f = await fixture((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000', 'Set-Cookie': 'synthetic=received; Path=/' }); res.end('{'); });
    try {
        await assert.rejects(f.context.post('/synthetic', { data: { synthetic: true }, maxRetries: 0 }));
        assert.equal((await f.context.storageState()).cookies[0]?.value, 'received');
        assert.equal(f.counts().arrivals, 1);
    }
    finally {
        await f.close();
    }
});
test('server receipt followed by lost response stays a single failed POST', { timeout: 15000 }, async () => {
    let committed = 0;
    const f = await fixture((req) => { req.resume(); req.once('end', () => { committed++; req.socket.destroy(); }); });
    try {
        await assert.rejects(f.context.post('/synthetic', { data: { synthetic: true } }));
        assert.equal(committed, 1);
        assert.deepEqual(f.counts(), { arrivals: 1, sockets: 1, dropped: 0 });
    }
    finally {
        await f.close();
    }
});
test('request method, JSON bytes, Origin and CSRF headers are unchanged', { timeout: 15000 }, async () => {
    const f = await fixture((req, res) => { let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; }); req.once('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ method: req.method, body, origin: req.headers.origin, csrf: req.headers['x-csrf-token'] })); }); });
    try {
        const data = { synthetic: true, text: '原請求' };
        const response = await f.context.post('/synthetic', { data, headers: { Origin: f.origin, 'X-CSRF-Token': 'synthetic-csrf' }, maxRetries: 0 });
        assert.deepEqual(await response.json(), { method: 'POST', body: JSON.stringify(data), origin: f.origin, csrf: 'synthetic-csrf' });
        assert.equal(f.counts().arrivals, 1);
    }
    finally {
        await f.close();
    }
});
test('a concurrent unrelated cookie response is not overwritten by login cookie changes', { timeout: 15000 }, async (t) => {
    let loginResponse: ServerResponse | undefined, entered!: () => void;
    const arrived = new Promise<void>(resolve => { entered = resolve; });
    const f = await fixture((req, res) => {
        req.resume();
        if (req.url === '/login') {
            loginResponse = res;
            entered();
        }
        else {
            res.setHeader('Set-Cookie', 'unrelated=concurrent; Path=/');
            res.end('{}');
        }
    });
    let login: ReturnType<APIRequestContext['post']> | undefined;
    try {
        login = f.context.post('/login', { data: { synthetic: true }, maxRetries: 0 });
        const aborted = new Promise<never>((_, reject) => t.signal.addEventListener('abort', () => reject(t.signal.reason), { once: true }));
        await Promise.race([arrived, login.then(() => { throw new Error('Login response arrived before its controlled release.'); }), aborted]);
        await (await f.context.get('/unrelated')).body();
        assert.ok(loginResponse);
        loginResponse.setHeader('Set-Cookie', ['session=new-synthetic; Path=/', 'flow=; Path=/; Max-Age=0']);
        loginResponse.end('{}');
        await (await login).body();
        assert.deepEqual((await f.context.storageState()).cookies.map(c => [c.name, c.value]).sort(), [['session', 'new-synthetic'], ['unrelated', 'concurrent']]);
        assert.deepEqual(f.counts(), { arrivals: 2, sockets: 2, dropped: 0 });
    }
    finally {
        loginResponse?.destroy();
        await f.close();
        await login?.catch(() => { });
    }
});
test('the owned cart listener installs the real policy before awaiting server readiness', { timeout: 15000 }, () => {
    const source = ts.createSourceFile('fixture.ts', readFileSync(new URL('../e2e/storefront-cart-fixture.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'openCartListener');
    assert.ok(declaration?.body);
    const setup = declaration.body.statements.find((s): s is ts.TryStatement => ts.isTryStatement(s));
    assert.ok(setup);
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
