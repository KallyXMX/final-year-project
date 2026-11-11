// Entry point. Starts the web server and a 60-second background job that
// (1) shortlists vacancies whose deadline has passed and (2) auto-submits abandoned exam attempts.
// Layer: Application.
const app = require('./app');
const { runDueShortlisting } = require('./services/shortlisting');
const { finalizeStaleAttempts } = require('./services/exam');

const PORT = process.env.PORT || 3000;

// Background jobs (Requirements 4.1, 4.3, 4.4):
//  - recruitment closes automatically after the deadline, and shortlisting then runs automatically
//  - abandoned exam attempts are auto-submitted and marked
const tick = () => {
  try {
    const done = runDueShortlisting();
    done.forEach((d) => console.log(`[auto] shortlisted vacancy ${d.id}: ${d.shortlisted}/${d.total}`));
    const n = finalizeStaleAttempts();
    if (n) console.log(`[auto] auto-submitted ${n} exam attempt(s)`);
  } catch (e) {
    console.error('Scheduler error:', e);
  }
};
tick();
setInterval(tick, 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
