export interface SemanticAssertion {
  id: string;
  expected: string;
  observed: string;
  passed: boolean;
}

export function containsExpected(observed: string, expected: string): boolean;
export function hasExpectedStatusResponse(disposition: string | null, notification: string | null): boolean;
export function allSemanticAssertionsPassed(assertions: readonly SemanticAssertion[]): boolean;
