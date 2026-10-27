const { endOfLocalDay, startOfLocalDay, parseDbDate } = require('./time');

// Recruitment opens and closes automatically from the vacancy dates (Requirement 4.1).
// HR may also close a vacancy early (closed_at).
const vacancyState = (v, now = new Date()) => {
  if (!v) return 'Closed';
  if (v.closed_at) return 'Closed';
  const open = v.opens_at ? startOfLocalDay(v.opens_at) : null;
  const close = v.deadline ? endOfLocalDay(v.deadline) : null;
  if (open && now < open) return 'Upcoming';
  if (close && now > close) return 'Closed';
  return 'Open';
};

const examWindow = (v) => ({
  start: v && v.exam_start ? parseDbDate(v.exam_start) : null,
  end: v && v.exam_end ? parseDbDate(v.exam_end) : null
});

// 'NotScheduled' | 'Upcoming' | 'Open' | 'Ended'
const examState = (v, now = new Date()) => {
  const { start, end } = examWindow(v);
  if (!start || !end) return 'NotScheduled';
  if (now < start) return 'Upcoming';
  if (now > end) return 'Ended';
  return 'Open';
};

const isAcademic = (v) => v && v.category === 'academic';

module.exports = { vacancyState, examState, examWindow, isAcademic };
