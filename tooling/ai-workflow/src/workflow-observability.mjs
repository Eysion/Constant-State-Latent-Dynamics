function latestEvent(record, nodeId, types) {
  return record.events.filter((event) => event.nodeId === nodeId && types.includes(event.eventType)).at(-1)
}

function counts(nodeStates) {
  return Object.values(nodeStates).reduce((output, state) => ({ ...output, [state]: (output[state] ?? 0) + 1 }), {})
}

function nextActions(record, projection) {
  const run = ` --run ${projection.runId}`
  if (Object.keys(projection.activeExecutions).length > 0) {
    return [{ kind: 'monitor', message: 'A node is executing; inspect the next status update before taking another action.', command: `workflow status${run} --verbose` }]
  }
  const failed = Object.entries(projection.nodeStates).find(([, state]) => state === 'failed')
  if (failed) {
    return [{ kind: 'investigate-failure', nodeId: failed[0], message: 'Inspect the failure and timeline before deciding whether to retry or start a corrected Run.', command: `workflow timeline${run}` }]
  }
  const waiting = Object.entries(projection.nodeStates).find(([, state]) => state === 'waiting')
  if (waiting) {
    return [{ kind: 'provide-evidence', nodeId: waiting[0], message: 'This node is waiting for structured evidence or an operator action.', command: `workflow resolve${run} --node ${waiting[0]} --evidence-file <evidence.json>` }]
  }
  if (Object.values(projection.nodeStates).some((state) => state === 'ready')) {
    return [{ kind: 'advance', message: 'The Run has ready nodes and can advance until it needs evidence or completes.', command: `workflow resume${run}` }]
  }
  if (projection.status === 'completed') {
    return [{ kind: 'review', message: 'The Run is complete; inspect its decision and event history for handoff or audit.', command: `workflow explain${run}` }]
  }
  return []
}

function toolUsage(record) {
  const calls = record.events.filter((event) => event.type === 'TOOL_CALL_FINISHED').map((event) => event.evidence)
  return { calls: calls.length, costUnits: calls.reduce((sum, call) => sum + call.costUnits, 0), adopted: calls.filter((call) => call.adopted).length }
}

export function summarizeRun(record, projection) {
  const states = projection.nodeStates
  const waiting = Object.entries(states).filter(([, state]) => state === 'waiting').map(([nodeId]) => ({
    nodeId,
    evidence: latestEvent(record, nodeId, ['NODE_WAITING'])?.evidence ?? null,
  }))
  const failed = Object.entries(states).filter(([, state]) => state === 'failed').map(([nodeId]) => ({
    nodeId,
    error: latestEvent(record, nodeId, ['NODE_FAILED'])?.error ?? null,
  }))
  return {
    runId: projection.runId,
    status: projection.status,
    progress: { total: Object.keys(states).length, byState: counts(states), completed: (counts(states).succeeded ?? 0) + (counts(states).skipped ?? 0) },
    readyNodes: Object.entries(states).filter(([, state]) => state === 'ready').map(([nodeId]) => nodeId),
    activeExecutions: projection.activeExecutions,
    waiting,
    failed,
    toolUsage: toolUsage(record),
    nextActions: nextActions(record, projection),
    lastEvent: record.events.at(-1) ?? null,
  }
}

export function explainRun(record, projection) {
  return {
    runId: projection.runId,
    planHash: projection.planHash,
    status: projection.status,
    request: record.plan.context.request,
    signals: record.plan.context.signals,
    eventGates: record.plan.context.eventGates ?? [],
    qualityGate: record.plan.context.qualityGate,
    evidenceRoute: record.plan.context.evidenceRoute,
    toolUsage: toolUsage(record),
    contextReferences: record.events
      .filter((event) => event.type === 'CONTEXT_RECORDED')
      .map((event) => ({ sequence: event.sequence, at: event.at, ...event.evidence })),
    modes: { planning: record.plan.context.planningMode, execution: record.plan.context.executionMode, reasons: record.plan.context.modeReasons },
    planningReasons: record.plan.planningReasons,
    includedNodes: record.plan.nodes.map((node) => ({ id: node.id, type: node.type, requires: node.requires, state: projection.nodeStates[node.id] })),
    skippedNodes: record.plan.skippedNodes,
  }
}

export function timelineRun(record) {
  return record.events.map((event) => ({
    sequence: event.sequence,
    at: event.at,
    type: event.type,
    nodeId: event.nodeId ?? null,
    transition: event.eventType ?? null,
    state: event.nextState ?? null,
    error: event.error ?? null,
  }))
}
