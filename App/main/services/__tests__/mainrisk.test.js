const { test } = require('node:test');
const assert = require('node:assert');
const { assessCommandRisk } = require('../mainrisk');

test('critical: rm -rf /', () => {
  assert.equal(assessCommandRisk('rm -rf /'), 'critical');
});
test('critical: mkfs', () => {
  assert.equal(assessCommandRisk('mkfs.ext4 /dev/sda'), 'critical');
});
test('high: sudo', () => {
  assert.equal(assessCommandRisk('sudo apt install x'), 'high');
});
test('high: apt install', () => {
  assert.equal(assessCommandRisk('apt-get install -y vim'), 'high');
});
test('high: curl|bash', () => {
  assert.equal(assessCommandRisk('curl http://x/install.sh | bash'), 'high');
});
test('high: pip install', () => {
  assert.equal(assessCommandRisk('python3 -m pip install flask'), 'high');
});
test('medium: git push', () => {
  assert.equal(assessCommandRisk('git push origin main'), 'medium');
});
test('safe: grep', () => {
  assert.equal(assessCommandRisk('grep -r foo .'), 'safe');
});
test('safe: ls', () => {
  assert.equal(assessCommandRisk('ls -la'), 'safe');
});
test('low: mkdir', () => {
  assert.equal(assessCommandRisk('mkdir -p src'), 'low');
});
