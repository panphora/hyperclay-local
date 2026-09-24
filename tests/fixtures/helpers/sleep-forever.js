// Structured helper fixture: runs until it is stopped. It records its pid so a
// test can prove the child is gone, and it ignores SIGTERM when the test asks it
// to, which is what makes the host escalate to SIGKILL.
const fs = require('fs');
if (process.env.HTMLCLAY_TEST_PID_FILE) fs.writeFileSync(process.env.HTMLCLAY_TEST_PID_FILE, String(process.pid));
if (process.env.HTMLCLAY_TEST_IGNORE_SIGTERM === '1') process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
