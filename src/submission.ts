import { DurableObject } from 'cloudflare:workers'

import type { SubmissionEvent } from './events'

const SUBPROTOCOL = 'graphql-transport-ws'

const MAX_SUBSCRIPTIONS = 16


const TTL_MS = 15 * 60 * 1000
const expiry = () => Date.now() + TTL_MS + Math.floor(Math.random() * (TTL_MS / 4))


const RECONNECT = 4403
const BAD_REQUEST = 4400

interface SocketState {
  ids: string[]
  expiresAt: number
}

const readState = (ws: WebSocket) => (ws.deserializeAttachment() ?? { ids: [], expiresAt: 0 }) as SocketState

export class Submission extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ type: 'ping' }), JSON.stringify({ type: 'pong' })),
    )
  }

  async fetch(request: Request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 })
    }
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ ids: [], expiresAt: expiry() } satisfies SocketState)

    const offered = request.headers.get('Sec-WebSocket-Protocol')?.split(',') ?? []
    const headers = new Headers()
    if (offered.some((entry) => entry.trim() === SUBPROTOCOL)) {
      headers.set('Sec-WebSocket-Protocol', SUBPROTOCOL)
    }
    return new Response(null, { status: 101, webSocket: client, headers })
  }

  relay(event: SubmissionEvent) {
    const payload = { data: { submissionEvents: event } }
    this.ctx.getWebSockets().forEach((ws) => {
      const state = readState(ws)
      if (state.expiresAt <= Date.now()) {
        return ws.close(RECONNECT, 'authorization expired')
      }
      try {
        state.ids.forEach((id) => ws.send(JSON.stringify({ type: 'next', id, payload })))
      } catch {
        ws.close()
      }
    })
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let message: unknown
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return ws.close(BAD_REQUEST, 'invalid json')
    }

    if (typeof message !== 'object' || message === null) {
      return ws.close(BAD_REQUEST, 'expected a json object')
    }

    const frame = message as Record<string, unknown>
    const state = readState(ws)
    const id = typeof frame.id === 'string' ? frame.id : null

    switch (frame.type) {
      case 'connection_init':
        return ws.send(JSON.stringify({ type: 'connection_ack' }))
      case 'subscribe':

        if (!id) {
          return ws.close(BAD_REQUEST, 'invalid subscription id')
        }
        if (state.ids.includes(id)) {
          return
        }
        if (state.ids.length >= MAX_SUBSCRIPTIONS) {
          return ws.close(BAD_REQUEST, 'too many subscriptions')
        }
        return ws.serializeAttachment({ ...state, ids: [...state.ids, id] })
      case 'complete':
        if (!id) {
          return ws.close(BAD_REQUEST, 'invalid subscription id')
        }
        return ws.serializeAttachment({ ...state, ids: state.ids.filter((open) => open !== id) })

      case 'ping':
        return ws.send(JSON.stringify({ type: 'pong' }))
      case 'pong':
        return
      default:
        return ws.close(BAD_REQUEST, 'unexpected message type')
    }
  }
}
