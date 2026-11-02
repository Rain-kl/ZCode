import { createModelRecoveryBudget } from "./contract.js";
export function exampleRequestClaims(): number[] {
  const budget = createModelRecoveryBudget(2);
  return [budget.claimAttempt(), budget.claimAttempt()].filter(
    (attempt): attempt is number => attempt !== undefined,
  );
}
