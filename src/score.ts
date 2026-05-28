export const THRESHOLD = 0.6;

export interface Decision {
  approved: boolean;
  fraud_score: number;
}

export function decide(fraudScore: number): Decision {
  return { approved: fraudScore < THRESHOLD, fraud_score: fraudScore };
}
