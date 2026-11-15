// Shared end-of-run cleanup for the e2e scripts (not a test itself).
// On Windows, removing the temp folder can fail with EPERM/EBUSY while the SQLite file or a socket is still being released.
// So: stop the test server, close the SQLite connection, then try to remove the folder a few times.
// A cleanup problem only prints a warning; it never throws and never changes the exit code of the script.
const fs = require('fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanup = async ({ server, db, tmp }) => {
  try {
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); // drop keep-alive sockets so close() can finish
      await Promise.race([new Promise((resolve) => server.close(() => resolve())), sleep(2000)]);
    }
  } catch (e) { console.warn(`Warning: could not stop the test server cleanly (${e.code || e.message}).`); }

  try { if (db && db.open !== false) db.close(); }
  catch (e) { console.warn(`Warning: could not close the test database (${e.code || e.message}).`); }

  const attempts = 5;
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === attempts) {
        console.warn(`Warning: could not remove the temporary folder ${tmp} (${e.code || e.message}). It is safe to delete it by hand.`);
        return;
      }
      await sleep(250 * i);
    }
  }
};

module.exports = { cleanup };
