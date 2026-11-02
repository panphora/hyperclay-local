const { validateStaple } = require('../../build-scripts/stapler-validate');

const sleep = () => {};

test('a dropped connection is retried until validate passes', () => {
  const run = jest.fn()
    .mockImplementationOnce(() => { throw new Error('Error 68'); })
    .mockImplementationOnce(() => {});
  validateStaple('/a.app', { run, sleep });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledWith('xcrun stapler validate "/a.app"');
});

test('a ticket that never validates still fails', () => {
  const run = jest.fn(() => { throw new Error('Error 65'); });
  expect(() => validateStaple('/a.app', { run, sleep })).toThrow('Error 65');
  expect(run).toHaveBeenCalledTimes(4);
});
