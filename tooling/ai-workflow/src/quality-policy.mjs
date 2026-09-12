export const DEFAULT_QUALITY_POLICY = Object.freeze({
  enabled: false,
  highRiskSignals: Object.freeze([]),
  negativeFeedbackSignals: Object.freeze([]),
  candidateCount: 2,
  accuracyThreshold: 0.85,
})

function matches(signals, candidates) {
  const present = new Set(signals)
  return candidates.filter((signal) => present.has(signal))
}

export function resolveQualityGate({ policy = DEFAULT_QUALITY_POLICY, signals = [] } = {}) {
  if (!policy.enabled) {
    return {
      enabled: false, candidateCount: policy.candidateCount, accuracyThreshold: policy.accuracyThreshold,
      fallback: 'verify-or-clarify', triggers: [], reasons: ['quality gate is not enabled for this initialized project'],
    }
  }
  const highRiskSignals = matches(signals, policy.highRiskSignals)
  const negativeFeedbackSignals = matches(signals, policy.negativeFeedbackSignals)
  const enabled = highRiskSignals.length > 0 || negativeFeedbackSignals.length > 0
  return {
    enabled,
    candidateCount: policy.candidateCount,
    accuracyThreshold: policy.accuracyThreshold,
    fallback: 'verify-or-clarify',
    triggers: [
      ...highRiskSignals.map((signal) => ({ signal, source: 'high-risk' })),
      ...negativeFeedbackSignals.map((signal) => ({ signal, source: 'negative-feedback' })),
    ],
    reasons: enabled
      ? [
          ...highRiskSignals.map((signal) => `quality gate enabled: high-risk signal ${signal}`),
          ...negativeFeedbackSignals.map((signal) => `quality gate enabled: negative-feedback signal ${signal}`),
          `generate ${policy.candidateCount} independent candidates and require evidence-backed accuracy >= ${policy.accuracyThreshold}`,
        ]
      : ['quality gate not required: no high-risk or negative-feedback signal'],
  }
}
