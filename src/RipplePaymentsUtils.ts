import { PaymentsUtils, NetworkType, Payport } from '@faast/payments-common'
import { RippleAPI } from 'ripple-lib'

import {
  toMainDenominationString,
  toBaseDenominationString,
  isValidXprv,
  isValidXpub,
  isValidAddress,
  isValidExtraId,
} from './helpers'
import { Logger, DelegateLogger, isNil, assertType } from '@faast/ts-common'
import { PACKAGE_NAME, DEFAULT_NETWORK } from './constants'
import { BaseRippleConfig } from './types'
import { resolveRippleServer, retryIfDisconnected } from './utils'

export class RipplePaymentsUtils implements PaymentsUtils {
  networkType: NetworkType
  logger: Logger
  rippleApi: RippleAPI
  server: string | null

  constructor(config: BaseRippleConfig = {}) {
    assertType(BaseRippleConfig, config)
    this.networkType = config.network || DEFAULT_NETWORK
    this.logger = new DelegateLogger(config.logger, PACKAGE_NAME)
    const { api, server } = resolveRippleServer(config.server, this.networkType)
    this.rippleApi = api
    this.server = server
  }

  async init(): Promise<void> {
    if (!this.rippleApi.isConnected()) {
      await this.rippleApi.connect()
    }
  }

  async destroy(): Promise<void> {
    if (this.rippleApi.isConnected()) {
      await this.rippleApi.disconnect()
    }
  }

  async _retryDced<T>(fn: () => Promise<T>): Promise<T> {
    return retryIfDisconnected(fn, this.rippleApi, this.logger)
  }

  async isValidExtraId(extraId: string): Promise<boolean> {
    return isValidExtraId(extraId)
  }

  async isValidAddress(address: string): Promise<boolean> {
    return isValidAddress(address)
  }

  private async getPayportValidationMessage(payport: Payport): Promise<string | undefined> {
    const { address, extraId } = payport
    if (!(await this.isValidAddress(address))) {
      return 'Invalid payport address'
    }
    let requireExtraId = false
    try {
      const settings = await this._retryDced(() => this.rippleApi.getSettings(address))
      requireExtraId = settings.requireDestinationTag || false
    } catch (e) {
      this.logger.debug(`Failed to retrieve settings for ${address} - ${e.message}`)
    }
    if (isNil(extraId)) {
      if (requireExtraId) {
        return `Payport extraId is required for address ${address} with ripple requireDestinationTag setting enabled`
      }
    } else if (!(await this.isValidExtraId(extraId))) {
      return 'Invalid payport extraId'
    }
  }

  async validatePayport(payport: Payport): Promise<void> {
    assertType(Payport, payport)
    const message = await this.getPayportValidationMessage(payport)
    if (message) {
      throw new Error(message)
    }
  }

  async isValidPayport(payport: Payport): Promise<boolean> {
    if (!Payport.is(payport)) {
      return false
    }
    return !(await this.getPayportValidationMessage(payport))
  }

  toMainDenomination(amount: string | number): string {
    return toMainDenominationString(amount)
  }

  toBaseDenomination(amount: string | number): string {
    return toBaseDenominationString(amount)
  }

  isValidXprv = isValidXprv
  isValidXpub = isValidXpub
}
