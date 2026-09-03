import { isIngestAuthorized, isOriginAllowed, isSubscriptionAuthorized } from './auth'
import { parseSubmissionEvent } from './events'
import { Submission } from './submission'

export { Submission }

const INGEST_PATH = '/__ingest'
const GRAPHQL_PATH = '/lw/graphql'

export default {
  fetch: async (request: Request, env: Env) => {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === INGEST_PATH) {
      if (!(await isIngestAuthorized(request, env))) {
        return new Response('unauthorized', { status: 401 })
      }
      const event = parseSubmissionEvent(await request.json().catch(() => null))
      if (!event) {
        return new Response('invalid signal', { status: 422 })
      }

      await env.SUBMISSION.getByName(event.submissionId).relay(event)
      return new Response(null, { status: 202 })
    }

    if (request.headers.get('Upgrade') === 'websocket' && url.pathname === GRAPHQL_PATH) {
      const submissionId = url.searchParams.get('submissionId')
      if (!submissionId) {
        return new Response('missing submissionId', { status: 400 })
      }
      if (!isOriginAllowed(request, env)) {
        return new Response('forbidden', { status: 403 })
      }
      if (!(await isSubscriptionAuthorized(request, submissionId))) {
        return new Response('unauthorized', { status: 401 })
      }
      return env.SUBMISSION.getByName(submissionId).fetch(request)
    }

    return fetch(request)
  },
}
