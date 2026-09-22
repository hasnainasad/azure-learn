const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseEnvFile } = require('../src/envFile');

test('parses simple KEY=value lines', () => {
  const vars = parseEnvFile('PORT=3000\nNODE_ENV=production\n');
  assert.deepEqual(vars, { PORT: '3000', NODE_ENV: 'production' });
});

test('keeps "&" and other shell metacharacters intact - the bug this file exists to avoid', () => {
  const url = 'mongodb://user:pass@host.mongo.cosmos.azure.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false';
  const vars = parseEnvFile(`MONGO_URL=${url}\nJWT_SECRET=abc123\n`);
  assert.equal(vars.MONGO_URL, url);
  assert.equal((vars.MONGO_URL.match(/&/g) || []).length, 2);
});

test('a value with "#" is kept, but a line starting with "#" is a comment', () => {
  const vars = parseEnvFile('# a comment\nSECRET=abc#def\n');
  assert.equal(vars.SECRET, 'abc#def');
  assert.equal(Object.keys(vars).length, 1);
});

test('skips blank lines and trims surrounding whitespace on the line', () => {
  const vars = parseEnvFile('\n  PORT=3000  \n\n');
  assert.equal(vars.PORT, '3000');
});

test('a line with no "=" is ignored rather than crashing', () => {
  const vars = parseEnvFile('not a valid line\nPORT=3000\n');
  assert.deepEqual(vars, { PORT: '3000' });
});

test('only the first "=" splits key from value', () => {
  const vars = parseEnvFile('QUERY=a=b=c\n');
  assert.equal(vars.QUERY, 'a=b=c');
});
