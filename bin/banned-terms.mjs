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
  // 15 Jul lesson: agent run-notes named application targets on
  // work-visible surfaces; the employers he applies to are banned words too.
  'westpac', 'siemens',
  // 21 Jul sweep: targets that entered notes and board tasks since then.
  // 'culture amp' both spaced and joined so neither spelling slips through.
  'austrade', 'alinta', 'rabobank', 'culture amp', 'cultureamp',
]
