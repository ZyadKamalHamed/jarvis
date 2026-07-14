// Words that must never appear in anything served in work mode,
// case-insensitive. Single source of truth: the server filters with it at
// serving time, bin/selfcheck.mjs gates every commit with it. Deliberately
// strict, a false positive costs a minute, a leak costs a job. The list may
// be extended, never trimmed.
export const BANNED = [
  'career', 'jobhunt', 'job hunt', 'job application', 'application', 'interview',
  'recruiter', 'leetcode', 'codesignal', 'dsa', 'aios', 'resume', 'cover letter',
  'salary review', 'garvan', 'seek.com', 'jobs surfaced', 'apps sent',
  'hirevue', 'greenhouse', 'magtanong', 'sonder', 'deloitte', 'commbank',
  'amberjack', 'gradconnection', 'avature', 'assessments.amazon',
]
