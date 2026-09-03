export interface SubmissionEvent {
  kind: string
  submissionId: string
  stepId: string | null
  documentId: string | null
}

const optional = (value: unknown) => (typeof value === 'string' ? value : null)

export const parseSubmissionEvent = (body: unknown): SubmissionEvent | null => {
  const signal = body as Record<string, unknown> | null
  if (typeof signal?.kind !== 'string' || typeof signal?.submissionId !== 'string') {
    return null
  }
  return {
    kind: signal.kind,
    submissionId: signal.submissionId,
    stepId: optional(signal.stepId),
    documentId: optional(signal.documentId),
  }
}
