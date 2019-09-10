import { BaseRippleConfig } from './types'
import { RippleAPI } from 'ripple-lib'
import { isString } from 'util'
import { NetworkType } from '@faast/payments-common'
import promiseRetry from 'promise-retry'
import { DEFAULT_TESTNET_SERVER, DEFAULT_MAINNET_SERVER } from './constants'
import { Logger } from '@faast/ts-common'

export function padLeft(x: string, n: number, v: string): string {
  while (x.length < n) {
    x = `${v}${x}`
  }
  return x
}

export type ResolvedServer = {
  api: RippleAPI
  server: string | null
}

export function resolveRippleServer(server: BaseRippleConfig['server'], network: NetworkType): ResolvedServer {
  if (typeof server === 'undefined') {
    server = network === NetworkType.Testnet ? DEFAULT_TESTNET_SERVER : DEFAULT_MAINNET_SERVER
  }
  if (isString(server)) {
    return {
      api: new RippleAPI({
        server,
      }),
      server,
    }
  } else if (server instanceof RippleAPI) {
    return {
      api: server,
      server: (server.connection as any)._url || '',
    }
  } else {
    // null server arg -> offline mode
    return {
      api: new RippleAPI(),
      server: null,
    }
  }
}

const CONNECTION_ERRORS = ['ConnectionError', 'NotConnectedError', 'DisconnectedError']
const RETRYABLE_ERRORS = [...CONNECTION_ERRORS, 'TimeoutError']
const MAX_RETRIES = 3

export function retryIfDisconnected<T>(fn: () => Promise<T>, rippleApi: RippleAPI, logger: Logger): Promise<T> {
  return promiseRetry(
    (retry, attempt) => {
      return fn().catch(async e => {
        const eName = e ? e.constructor.name : ''
        if (RETRYABLE_ERRORS.includes(eName)) {
          if (CONNECTION_ERRORS.includes(eName)) {
            logger.log(
              'Connection error during rippleApi call, attempting to reconnect then ' +
                `retrying ${MAX_RETRIES - attempt} more times`,
              e.toString(),
            )
            if (rippleApi.isConnected()) {
              await rippleApi.disconnect()
            }
            await rippleApi.connect()
          } else {
            logger.log(
              `Retryable error during rippleApi call, retrying ${MAX_RETRIES - attempt} more times`,
              e.toString(),
            )
          }
          retry(e)
        }
        throw e
      })
    },
    {
      retries: MAX_RETRIES,
    },
  )
}
