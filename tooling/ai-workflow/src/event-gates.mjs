function makeEvidence(signal, source, details = {}) {
  return { signal, source, confidence: source === 'operator' ? 'declared' : 'deterministic', ...details }
}

export function deriveEventGates({
  signals = [],
  changedFiles = [],
  repositories = [],
  mode = 'single',
} = {}) {
  const normalized = new Set(signals)
  const evidence = signals.map((signal) => makeEvidence(signal, 'operator'))
  const touched = repositories.filter((repository) =>
    changedFiles.some((file) => file === repository.path || file.startsWith(repository.path + '/')))
  if (mode === 'workspace' && touched.length > 1) {
    normalized.add('CROSS_REPO_AFFECTED')
    evidence.push(makeEvidence('CROSS_REPO_AFFECTED', 'deterministic', { repositories: touched.map((item) => item.id) }))
  }
  return { signals: [...normalized].sort(), evidence }
}
