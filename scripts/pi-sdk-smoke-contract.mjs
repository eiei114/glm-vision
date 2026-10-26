export function containsExpected(observed, expected) {
  return typeof observed === "string" && observed.includes(expected);
}

export function allSemanticAssertionsPassed(assertions) {
  return assertions.every((assertion) => assertion.passed === true);
}
