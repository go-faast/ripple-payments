import { AccountRipplePaymentsConfig, RippleKeyPair, RippleSecretPair, } from './types';
import { BaseRipplePayments } from './BaseRipplePayments';
import { assertType } from '@faast/ts-common';
import { isValidAddress } from './helpers';
export class AccountRipplePayments extends BaseRipplePayments {
    constructor(config) {
        super(config);
        this.readOnly = false;
        assertType(AccountRipplePaymentsConfig, config);
        this.hotSignatory = this.accountConfigToSignatory(config.hotAccount);
        this.depositSignatory = this.accountConfigToSignatory(config.depositAccount);
    }
    accountConfigToSignatory(accountConfig) {
        if (RippleKeyPair.is(accountConfig)) {
            if (!accountConfig.privateKey) {
                this.readOnly = true;
            }
            const address = this.rippleApi.deriveAddress(accountConfig.publicKey);
            return {
                address,
                secret: accountConfig,
            };
        }
        else if (RippleSecretPair.is(accountConfig)) {
            if (!accountConfig.secret) {
                this.readOnly = true;
            }
            return accountConfig;
        }
        else if (isValidAddress(accountConfig)) {
            this.readOnly = true;
            return {
                address: accountConfig,
                secret: '',
            };
        }
        throw new Error('Invalid ripple account config provided to ripple payments');
    }
    isReadOnly() {
        return this.readOnly;
    }
    getPublicAccountConfig() {
        return {
            hotAccount: this.hotSignatory.address,
            depositAccount: this.depositSignatory.address,
        };
    }
    getAccountIds() {
        return [this.hotSignatory.address, this.depositSignatory.address];
    }
    getAccountId(index) {
        if (index < 0) {
            throw new Error(`Invalid ripple payments accountId index ${index}`);
        }
        if (index === 0) {
            return this.hotSignatory.address;
        }
        return this.depositSignatory.address;
    }
    getHotSignatory() {
        return this.hotSignatory;
    }
    getDepositSignatory() {
        return this.depositSignatory;
    }
}
//# sourceMappingURL=AccountRipplePayments.js.map