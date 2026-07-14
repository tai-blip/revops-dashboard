// Static quarterly business-plan config — NOT live data.
// Ported directly from the original dashboard's AE_PLAN constant.
// These only change when leadership updates the quarterly plan.

export const AE_PLAN: Record<
  string,
  { short: string; pipeGenTargetQ3: number; quotaQ3: number }
> = {
  "James Burdick": { short: "James", pipeGenTargetQ3: 738000, quotaQ3: 255000 },
  "Dorsa Mahmoudnia": { short: "Dorsa", pipeGenTargetQ3: 750000, quotaQ3: 250000 },
  "Jed Rutstein": { short: "Jed", pipeGenTargetQ3: 960000, quotaQ3: 250000 },
  "Jill Bucci": { short: "Jill", pipeGenTargetQ3: 850000, quotaQ3: 200000 },
  "Mathias Berthelemot": { short: "Mathias", pipeGenTargetQ3: 0, quotaQ3: 250000 },
  "David Dubinski": { short: "Davi", pipeGenTargetQ3: 0, quotaQ3: 0 },
};

export const TEAM_PIPE_GEN_TARGET_Q3 = Object.values(AE_PLAN).reduce(
  (s, a) => s + a.pipeGenTargetQ3,
  0
);
