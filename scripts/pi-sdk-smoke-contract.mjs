export function containsExpected(observed, expected) {
  return typeof observed === "string" && observed.includes(expected);
}

export function hasExpectedStatusResponse(disposition, notification) {
  return disposition === "handled" && containsExpected(notification, "glm-vision: ON");
}

export function allSemanticAssertionsPassed(assertions) {
  return assertions.every((assertion) => assertion.passed === true);
}
