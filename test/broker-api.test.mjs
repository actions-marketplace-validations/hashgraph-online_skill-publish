import assert from 'node:assert/strict';

import { requestJson, requestJsonWithTimeout } from '../bin/lib/broker-api.mjs';

function createFetchStub(log) {
  return async (url, options) => {
    log.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return { ok: true };
      },
      async text() {
        return JSON.stringify({ ok: true });
      },
    };
  };
}

const requestCalls = [];
await requestJson({
  method: 'GET',
  url: 'https://hol.org/registry/api/v1/skills/config?view=compact',
  fetchImplementation: createFetchStub(requestCalls),
});
assert.equal(requestCalls.length, 1);
assert.equal(
  requestCalls[0].url,
  'https://hol.org/registry/api/v1/skills/config?view=compact',
);

const timeoutCalls = [];
await requestJsonWithTimeout(
  'https://hol.org/registry/api/v1/credits/balance?accountId=0.0.123',
  {},
  8000,
  createFetchStub(timeoutCalls),
);
assert.equal(timeoutCalls.length, 1);
assert.equal(
  timeoutCalls[0].url,
  'https://hol.org/registry/api/v1/credits/balance?accountId=0.0.123',
);

process.stdout.write('broker api test passed\n');
