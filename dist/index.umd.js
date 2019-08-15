(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('bignumber.js'), require('io-ts'), require('bip32'), require('base-x'), require('crypto'), require('@faast/ts-common'), require('@faast/payments-common'), require('ripple-lib'), require('util')) :
  typeof define === 'function' && define.amd ? define(['exports', 'bignumber.js', 'io-ts', 'bip32', 'base-x', 'crypto', '@faast/ts-common', '@faast/payments-common', 'ripple-lib', 'util'], factory) :
  (factory((global.faastRipplePayments = {}),global.BigNumber,global.t,global.bip32,global.baseX,global.crypto,global.tsCommon,global.paymentsCommon,global.rippleLib,global.util));
}(this, (function (exports,BigNumber,t,bip32,baseX,crypto,tsCommon,paymentsCommon,rippleLib,util) { 'use strict';

  BigNumber = BigNumber && BigNumber.hasOwnProperty('default') ? BigNumber['default'] : BigNumber;
  baseX = baseX && baseX.hasOwnProperty('default') ? baseX['default'] : baseX;
  crypto = crypto && crypto.hasOwnProperty('default') ? crypto['default'] : crypto;

  const BaseRipplePaymentsConfig = tsCommon.extendCodec(paymentsCommon.BaseConfig, {}, {
      server: t.string,
      logger: tsCommon.Logger,
      maxLedgerVersionOffset: t.number,
  }, 'BaseRipplePaymentsConfig');
  const HdRipplePaymentsConfig = tsCommon.extendCodec(BaseRipplePaymentsConfig, {
      hdKey: t.string,
  }, 'HdRipplePaymentsConfig');
  const RippleKeyPair = t.type({
      publicKey: t.string,
      privateKey: t.string,
  }, 'RippleKeyPair');
  const RippleSecretPair = t.type({
      address: t.string,
      secret: t.string,
  }, 'RippleSecretPair');
  const RippleAccountConfig = t.union([t.string, RippleSecretPair, RippleKeyPair], 'RippleAccountConfig');
  const AccountRipplePaymentsConfig = tsCommon.extendCodec(BaseRipplePaymentsConfig, {
      hotAccount: RippleAccountConfig,
      depositAccount: RippleAccountConfig,
  }, 'AccountRipplePaymentsConfig');
  const RipplePaymentsConfig = t.union([HdRipplePaymentsConfig, AccountRipplePaymentsConfig], 'RipplePaymentsConfig');
  const RippleUnsignedTransaction = tsCommon.extendCodec(paymentsCommon.BaseUnsignedTransaction, {
      amount: t.string,
      fee: t.string,
  }, 'RippleUnsignedTransaction');
  const RippleSignedTransaction = tsCommon.extendCodec(paymentsCommon.BaseSignedTransaction, {
      id: t.string,
  }, 'RippleSignedTransaction');
  const RippleTransactionInfo = tsCommon.extendCodec(paymentsCommon.BaseTransactionInfo, {
      confirmationNumber: tsCommon.nullable(t.number),
  }, {}, 'RippleTransactionInfo');
  const RippleBroadcastResult = tsCommon.extendCodec(paymentsCommon.BaseBroadcastResult, {
      rebroadcast: t.boolean,
      data: t.object,
  }, 'RippleBroadcastResult');
  const RippleBalanceMonitorConfig = tsCommon.extendCodec(paymentsCommon.BaseConfig, {
      server: t.union([t.string, tsCommon.instanceofCodec(rippleLib.RippleAPI)]),
  }, 'RippleBalanceMonitorConfig');
  const RippleCreateTransactionOptions = tsCommon.extendCodec(paymentsCommon.CreateTransactionOptions, {}, {
      maxLedgerVersionOffset: t.number,
      sequence: t.number,
      payportBalance: t.string,
  }, 'RippleCreateTransactionOptions');

  const PACKAGE_NAME = 'ripple-payments';
  const DECIMAL_PLACES = 6;
  const MIN_BALANCE = 20;
  const DEFAULT_CREATE_TRANSACTION_OPTIONS = {};
  const DEFAULT_MAX_LEDGER_VERSION_OFFSET = 100;
  const ADDRESS_REGEX = /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/;
  const EXTRA_ID_REGEX = /^[0-9]+$/;
  const XPUB_REGEX = /^xpub[a-km-zA-HJ-NP-Z1-9]{100,108}$/;
  const XPRV_REGEX = /^xprv[a-km-zA-HJ-NP-Z1-9]{100,108}$/;
  const NOT_FOUND_ERRORS = ['MissingLedgerHistoryError', 'NotFoundError'];

  const { toMainDenominationBigNumber, toMainDenominationString, toMainDenominationNumber, toBaseDenominationBigNumber, toBaseDenominationString, toBaseDenominationNumber, } = paymentsCommon.createUnitConverters(DECIMAL_PLACES);
  function isValidXprv(xprv) {
      return typeof xprv === 'string' && XPRV_REGEX.test(xprv);
  }
  function isValidXpub(xpub) {
      return typeof xpub === 'string' && XPUB_REGEX.test(xpub);
  }
  function isValidAddress(address) {
      return typeof address === 'string' && ADDRESS_REGEX.test(address);
  }
  function isValidExtraId(extraId) {
      return typeof extraId === 'string' && EXTRA_ID_REGEX.test(extraId);
  }
  function assertValidAddress(address) {
      if (!isValidAddress(address)) {
          throw new Error(`Invalid ripple address: ${address}`);
      }
  }
  function assertValidExtraId(extraId) {
      if (!isValidExtraId(extraId)) {
          throw new Error(`Invalid ripple extraId: ${extraId}`);
      }
  }
  function assertValidExtraIdOrNil(extraId) {
      if (!tsCommon.isNil(extraId) && !isValidExtraId(extraId)) {
          throw new Error(`Invalid ripple extraId: ${extraId}`);
      }
  }

  class RipplePaymentsUtils {
      constructor(config = {}) {
          this.isValidXprv = isValidXprv;
          this.isValidXpub = isValidXpub;
          tsCommon.assertType(paymentsCommon.BaseConfig, config);
          this.networkType = config.network || paymentsCommon.NetworkType.Mainnet;
          this.logger = new tsCommon.DelegateLogger(config.logger, PACKAGE_NAME);
      }
      async isValidExtraId(extraId) {
          return isValidExtraId(extraId);
      }
      async isValidAddress(address) {
          return isValidAddress(address);
      }
      async isValidPayport(payport) {
          if (!paymentsCommon.Payport.is(payport)) {
              return false;
          }
          const { address, extraId } = payport;
          return (await this.isValidAddress(address)) && (tsCommon.isNil(extraId) ? true : this.isValidExtraId(extraId));
      }
      toMainDenomination(amount) {
          return toMainDenominationString(amount);
      }
      toBaseDenomination(amount) {
          return toBaseDenominationString(amount);
      }
  }

  function extraIdToTag(extraId) {
      return tsCommon.isNil(extraId) ? undefined : Number.parseInt(extraId);
  }
  function serializePayport(payport) {
      return tsCommon.isNil(payport.extraId) ? payport.address : `${payport.address}:${payport.extraId}`;
  }
  class BaseRipplePayments extends RipplePaymentsUtils {
      constructor(config) {
          super(config);
          this.config = config;
          tsCommon.assertType(BaseRipplePaymentsConfig, config);
          if (config.server) {
              this.rippleApi = new rippleLib.RippleAPI({
                  server: config.server,
              });
          }
          else {
              this.rippleApi = new rippleLib.RippleAPI();
          }
      }
      async init() {
          if (!this.rippleApi.isConnected()) {
              await this.rippleApi.connect();
          }
      }
      async destroy() {
          if (this.rippleApi.isConnected()) {
              await this.rippleApi.disconnect();
          }
      }
      getFullConfig() {
          return this.config;
      }
      async resolvePayport(payport) {
          if (typeof payport === 'number') {
              return this.getPayport(payport);
          }
          else if (typeof payport === 'string') {
              assertValidAddress(payport);
              return { address: payport };
          }
          assertValidAddress(payport.address);
          assertValidExtraIdOrNil(payport.extraId);
          return payport;
      }
      async resolveFromTo(from, to) {
          const fromPayport = await this.getPayport(from);
          const toPayport = await this.resolvePayport(to);
          return {
              fromAddress: fromPayport.address,
              fromIndex: from,
              fromExtraId: fromPayport.extraId,
              fromPayport,
              toAddress: toPayport.address,
              toIndex: typeof to === 'number' ? to : null,
              toExtraId: toPayport.extraId,
              toPayport,
          };
      }
      async getPayport(index) {
          if (index === 0) {
              return { address: this.getHotSignatory().address };
          }
          if (index === 1) {
              return { address: this.getDepositSignatory().address };
          }
          return { address: this.getDepositSignatory().address, extraId: String(index) };
      }
      requiresBalanceMonitor() {
          return true;
      }
      getAddressesToMonitor() {
          return [this.getHotSignatory().address, this.getDepositSignatory().address];
      }
      isSweepableAddressBalance(balance) {
          return new BigNumber(balance).gt(MIN_BALANCE);
      }
      async getBalance(payportOrIndex) {
          const payport = await this.resolvePayport(payportOrIndex);
          const { address, extraId } = payport;
          if (!tsCommon.isNil(extraId)) {
              throw new Error(`Cannot getBalance of ripple payport with extraId ${extraId}, use BalanceMonitor instead`);
          }
          const balances = await this.rippleApi.getBalances(address);
          const xrpBalance = balances.find(({ currency }) => currency === 'XRP');
          const xrpAmount = xrpBalance ? xrpBalance.value : '0';
          return {
              confirmedBalance: xrpAmount,
              unconfirmedBalance: '0',
              sweepable: this.isSweepableAddressBalance(xrpAmount),
          };
      }
      resolveIndexFromAdjustment(adjustment) {
          const { address, tag } = adjustment;
          if (address === this.getHotSignatory().address) {
              return 0;
          }
          else if (address === this.getDepositSignatory().address) {
              return tag || 1;
          }
          return null;
      }
      async getTransactionInfo(txId) {
          let tx;
          try {
              tx = await this.rippleApi.getTransaction(txId);
          }
          catch (e) {
              const eString = e.toString();
              if (NOT_FOUND_ERRORS.some(type => eString.includes(type))) {
                  throw new Error(`Transaction not found: ${eString}`);
              }
              throw e;
          }
          this.logger.debug('tx', JSON.stringify(tx, null, 2));
          if (tx.type !== 'payment') {
              throw new Error(`Unsupported ripple tx type ${tx.type}`);
          }
          const { specification, outcome } = tx;
          const { source, destination } = specification;
          const amountObject = (source.maxAmount || source.amount);
          if (amountObject.currency !== 'XRP') {
              throw new Error(`Unsupported ripple tx currency ${amountObject.currency}`);
          }
          const fromIndex = this.resolveIndexFromAdjustment(source);
          const toIndex = this.resolveIndexFromAdjustment(destination);
          const amount = amountObject.value;
          const status = outcome.result.startsWith('tes') ? paymentsCommon.TransactionStatus.Confirmed : paymentsCommon.TransactionStatus.Failed;
          const confirmationNumber = outcome.ledgerVersion;
          const ledger = await this.rippleApi.getLedger({ ledgerVersion: confirmationNumber });
          const currentLedgerVersion = await this.rippleApi.getLedgerVersion();
          const confirmationId = ledger.ledgerHash;
          const confirmationTimestamp = outcome.timestamp ? new Date(outcome.timestamp) : null;
          return {
              id: tx.id,
              fromIndex,
              fromAddress: source.address,
              fromExtraId: typeof source.tag !== 'undefined' ? String(source.tag) : null,
              toIndex,
              toAddress: destination.address,
              toExtraId: typeof destination.tag !== 'undefined' ? String(destination.tag) : null,
              amount: amount,
              fee: outcome.fee,
              status,
              confirmationId,
              confirmationNumber: ledger.ledgerVersion,
              confirmationTimestamp,
              isExecuted: status === 'confirmed',
              isConfirmed: true,
              confirmations: currentLedgerVersion - confirmationNumber,
              data: tx,
          };
      }
      async resolveFeeOption(feeOption) {
          let targetFeeLevel;
          let targetFeeRate;
          let targetFeeRateType;
          let feeMain;
          let feeBase;
          if (feeOption.feeLevel === paymentsCommon.FeeLevel.Custom) {
              targetFeeLevel = feeOption.feeLevel;
              targetFeeRate = feeOption.feeRate;
              targetFeeRateType = feeOption.feeRateType;
              if (targetFeeRateType === paymentsCommon.FeeRateType.Base) {
                  feeBase = targetFeeRate;
                  feeMain = this.toMainDenomination(feeBase);
              }
              else if (targetFeeRateType === paymentsCommon.FeeRateType.Main) {
                  feeMain = targetFeeRate;
                  feeBase = this.toBaseDenomination(feeMain);
              }
              else {
                  throw new Error(`Unsupport ripple feeRateType ${feeOption.feeRateType}`);
              }
          }
          else {
              targetFeeLevel = feeOption.feeLevel || paymentsCommon.FeeLevel.Medium;
              let cushion;
              if (targetFeeLevel === paymentsCommon.FeeLevel.Low) {
                  cushion = 1;
              }
              else if (targetFeeLevel === paymentsCommon.FeeLevel.Medium) {
                  cushion = 1.2;
              }
              else if (targetFeeLevel === paymentsCommon.FeeLevel.High) {
                  cushion = 1.5;
              }
              feeMain = await this.rippleApi.getFee(cushion);
              feeBase = this.toBaseDenomination(feeMain);
              targetFeeRate = feeMain;
              targetFeeRateType = paymentsCommon.FeeRateType.Main;
          }
          return {
              targetFeeLevel,
              targetFeeRate,
              targetFeeRateType,
              feeMain,
              feeBase,
          };
      }
      async resolvePayportBalance(fromPayport, options) {
          if (tsCommon.isNil(fromPayport.extraId)) {
              const balances = await this.getBalance(fromPayport);
              return new BigNumber(balances.confirmedBalance);
          }
          if (typeof options.payportBalance !== 'string') {
              throw new Error('ripple-payments createSweepTransaction missing required payportBalance option');
          }
          const payportBalance = new BigNumber(options.payportBalance);
          if (payportBalance.isNaN()) {
              throw new Error(`Invalid NaN payportBalance option provided: ${options.payportBalance}`);
          }
          return payportBalance;
      }
      async doCreateTransaction(fromTo, feeOption, amount, payportBalance, options) {
          if (amount.isNaN() || amount.lte(0)) {
              throw new Error(`Invalid amount provided to ripple-payments createTransaction: ${amount}`);
          }
          const { fromIndex, fromAddress, fromExtraId, fromPayport, toIndex, toAddress, toExtraId, toPayport } = fromTo;
          const { targetFeeLevel, targetFeeRate, targetFeeRateType, feeMain } = feeOption;
          const { sequence } = options;
          const maxLedgerVersionOffset = options.maxLedgerVersionOffset || this.config.maxLedgerVersionOffset || DEFAULT_MAX_LEDGER_VERSION_OFFSET;
          const amountString = amount.toString();
          const addressBalances = await this.getBalance({ address: fromAddress });
          const addressBalance = new BigNumber(addressBalances.confirmedBalance);
          if (addressBalance.lt(MIN_BALANCE)) {
              throw new Error(`Cannot send from ripple address that has less than ${MIN_BALANCE} XRP: ${fromAddress} (${addressBalance} XRP)`);
          }
          const totalValue = amount.plus(feeMain);
          if (addressBalance.minus(totalValue).lt(MIN_BALANCE)) {
              throw new Error(`Cannot send ${amountString} XRP with fee of ${feeMain} XRP because it would reduce the balance below ` +
                  `the minimum required balance of ${MIN_BALANCE} XRP: ${fromAddress} (${addressBalance} XRP)`);
          }
          if (typeof fromExtraId === 'string' && totalValue.gt(payportBalance)) {
              throw new Error(`Insufficient payport balance of ${payportBalance} XRP to send ${amountString} XRP ` +
                  `with fee of ${feeMain} XRP: ${serializePayport(fromPayport)}`);
          }
          const preparedTx = await this.rippleApi.preparePayment(fromAddress, {
              source: {
                  address: fromAddress,
                  tag: extraIdToTag(fromExtraId),
                  maxAmount: {
                      currency: 'XRP',
                      value: amountString,
                  },
              },
              destination: {
                  address: toAddress,
                  tag: extraIdToTag(toExtraId),
                  amount: {
                      currency: 'XRP',
                      value: amountString,
                  },
              },
          }, {
              maxLedgerVersionOffset,
              sequence,
          });
          return {
              id: null,
              fromIndex,
              fromAddress,
              fromExtraId,
              toIndex,
              toAddress,
              toExtraId,
              amount: amountString,
              targetFeeLevel,
              targetFeeRate,
              targetFeeRateType,
              fee: feeMain,
              status: paymentsCommon.TransactionStatus.Unsigned,
              data: preparedTx,
          };
      }
      async createTransaction(from, to, amount, options = DEFAULT_CREATE_TRANSACTION_OPTIONS) {
          const fromTo = await this.resolveFromTo(from, to);
          const feeOption = await this.resolveFeeOption(options);
          const payportBalance = await this.resolvePayportBalance(fromTo.fromPayport, options);
          const amountBn = new BigNumber(amount);
          return this.doCreateTransaction(fromTo, feeOption, amountBn, payportBalance, options);
      }
      async createSweepTransaction(from, to, options = DEFAULT_CREATE_TRANSACTION_OPTIONS) {
          const fromTo = await this.resolveFromTo(from, to);
          const feeOption = await this.resolveFeeOption(options);
          const payportBalance = await this.resolvePayportBalance(fromTo.fromPayport, options);
          let amountBn = payportBalance.minus(feeOption.feeMain);
          if (amountBn.lt(0)) {
              const fromPayport = { address: fromTo.fromAddress, extraId: fromTo.fromExtraId };
              throw new Error(`Insufficient balance to sweep from ripple payport with fee of ${feeOption.feeMain} XRP: ` +
                  `${serializePayport(fromPayport)} (${payportBalance} XRP)`);
          }
          if (typeof fromTo.fromExtraId !== 'string') {
              amountBn = amountBn.minus(MIN_BALANCE);
              if (amountBn.lt(0)) {
                  throw new Error(`Insufficient balance to sweep from ripple address with fee of ${feeOption.feeMain} XRP and ` +
                      `maintain the minimum required balance of ${MIN_BALANCE} XRP: ` +
                      `${fromTo.fromAddress} (${payportBalance} XRP)`);
              }
          }
          return this.doCreateTransaction(fromTo, feeOption, amountBn, payportBalance, options);
      }
      async signTransaction(unsignedTx) {
          tsCommon.assertType(RippleUnsignedTransaction, unsignedTx);
          if (this.isReadOnly()) {
              throw new Error('Cannot sign transaction with read only ripple payments (no xprv or secrets provided)');
          }
          this.logger.debug(unsignedTx.data);
          const { txJSON } = unsignedTx.data;
          let secret;
          const hotSignatory = this.getHotSignatory();
          const depositSignatory = this.getDepositSignatory();
          if (unsignedTx.fromAddress === hotSignatory.address) {
              secret = hotSignatory.secret;
          }
          else if (unsignedTx.fromAddress === depositSignatory.address) {
              secret = depositSignatory.secret;
          }
          else {
              throw new Error(`Cannot sign ripple transaction from address ${unsignedTx.fromAddress}`);
          }
          const signResult = this.rippleApi.sign(txJSON, secret);
          return {
              ...unsignedTx,
              id: signResult.id,
              data: signResult,
              status: paymentsCommon.TransactionStatus.Signed,
          };
      }
      async broadcastTransaction(signedTx) {
          tsCommon.assertType(RippleSignedTransaction, signedTx);
          const signedTxString = signedTx.data.signedTransaction;
          let rebroadcast = false;
          try {
              const existing = await this.getTransactionInfo(signedTx.id);
              rebroadcast = existing.id === signedTx.id;
          }
          catch (e) { }
          const result = (await this.rippleApi.submit(signedTxString));
          this.logger.debug('broadcasted', result);
          const resultCode = result.engine_result || result.resultCode || '';
          if (!resultCode.startsWith('tes')) {
              throw new Error(`Failed to broadcast ripple tx ${signedTx.id} with result code ${resultCode}`);
          }
          return {
              id: signedTx.id,
              rebroadcast,
              data: result,
          };
      }
  }

  function padLeft(x, n, v) {
      while (x.length < n) {
          x = `${v}${x}`;
      }
      return x;
  }

  const RIPPLE_B58_DICT = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
  const base58 = baseX(RIPPLE_B58_DICT);
  const derivationPath = "m/44'/144'/0'";
  const derivationPathParts = derivationPath.split('/').slice(1);
  function deriveSignatory(hdKey, index) {
      const key = bip32.fromBase58(hdKey);
      const derived = deriveBasePath(key)
          .derive(0)
          .derive(index);
      const privateKey = derived.isNeutered() ? '' : hdNodeToPrivateKey(derived);
      const publicKey = hdNodeToPublicKey(derived);
      const address = publicKeyToAddress(publicKey);
      return {
          address,
          secret: {
              privateKey,
              publicKey,
          },
      };
  }
  function xprvToXpub(xprv) {
      const key = typeof xprv === 'string' ? bip32.fromBase58(xprv) : xprv;
      const derivedPubKey = deriveBasePath(key);
      return derivedPubKey.neutered().toBase58();
  }
  function generateNewKeys() {
      const key = bip32.fromSeed(crypto.randomBytes(32));
      const xprv = key.toBase58();
      const xpub = xprvToXpub(xprv);
      return {
          xprv,
          xpub,
      };
  }
  function deriveBasePath(key) {
      const parts = derivationPathParts.slice(key.depth);
      if (parts.length > 0) {
          return key.derivePath(`m/${parts.join('/')}`);
      }
      return key;
  }
  function hdNodeToPublicKey(key) {
      const hexKey = padLeft(key.publicKey.toString('hex'), 66, '0');
      return hexKey.toUpperCase();
  }
  function hdNodeToPrivateKey(key) {
      if (key.isNeutered() || typeof key.privateKey === 'undefined') {
          throw new Error('Cannot derive private key from neutered bip32 node');
      }
      const hexKey = padLeft(key.privateKey.toString('hex'), 64, '0');
      return hexKey.toUpperCase();
  }
  function publicKeyToAddress(pubkeyHex) {
      const pubkeyBuffer = Buffer.from(pubkeyHex, 'hex');
      const pubkeyInnerHash = crypto.createHash('sha256').update(pubkeyBuffer);
      const pubkeyOuterHash = crypto.createHash('ripemd160');
      pubkeyOuterHash.update(pubkeyInnerHash.digest());
      const accountId = pubkeyOuterHash.digest();
      const addressTypePrefix = Buffer.from([0x00]);
      const payload = Buffer.concat([addressTypePrefix, accountId]);
      const chksumHash1 = crypto
          .createHash('sha256')
          .update(payload)
          .digest();
      const chksumHash2 = crypto
          .createHash('sha256')
          .update(chksumHash1)
          .digest();
      const checksum = chksumHash2.slice(0, 4);
      const dataToEncode = Buffer.concat([payload, checksum]);
      const address = base58.encode(dataToEncode);
      return address;
  }

  class HdRipplePayments extends BaseRipplePayments {
      constructor(config) {
          super(config);
          if (isValidXprv(config.hdKey)) {
              this.xprv = config.hdKey;
              this.xpub = xprvToXpub(this.xprv);
          }
          else if (isValidXpub(config.hdKey)) {
              this.xprv = null;
              this.xpub = config.hdKey;
          }
          else {
              throw new Error('Account must be a valid xprv or xpub');
          }
          this.hotSignatory = deriveSignatory(config.hdKey, 0);
          this.depositSignatory = deriveSignatory(config.hdKey, 1);
      }
      isReadOnly() {
          return this.xprv === null;
      }
      getPublicConfig() {
          return {
              ...this.config,
              hdKey: xprvToXpub(this.config.hdKey),
          };
      }
      getAccountIds() {
          return [this.xpub];
      }
      getAccountId(index) {
          return this.xpub;
      }
      getHotSignatory() {
          return this.hotSignatory;
      }
      getDepositSignatory() {
          return this.depositSignatory;
      }
  }
  HdRipplePayments.generateNewKeys = generateNewKeys;

  class AccountRipplePayments extends BaseRipplePayments {
      constructor(config) {
          super(config);
          this.readOnly = false;
          tsCommon.assertType(AccountRipplePaymentsConfig, config);
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
      getPublicConfig() {
          return {
              ...this.config,
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

  class RippleBalanceMonitor extends paymentsCommon.BalanceMonitor {
      constructor(config) {
          super(config);
          if (config.server instanceof rippleLib.RippleAPI) {
              this.rippleApi = config.server;
          }
          else {
              this.rippleApi = new rippleLib.RippleAPI({ server: config.server });
          }
      }
      async init() {
          if (!this.rippleApi.isConnected()) {
              await this.rippleApi.connect();
          }
      }
      async destroy() {
          if (this.rippleApi.isConnected()) {
              await this.rippleApi.disconnect();
          }
      }
      async subscribeAddresses(addresses) {
          for (let address of addresses) {
              assertValidAddress(address);
          }
          try {
              const res = await this.rippleApi.request('subscribe', { accounts: addresses });
              if (res.status === 'success') {
                  this.logger.log('Ripple successfully subscribed', res);
              }
              else {
                  this.logger.warn('Ripple subscribe unsuccessful', res);
              }
          }
          catch (e) {
              this.logger.error('Failed to subscribe to ripple addresses', e.toString());
              throw e;
          }
      }
      onBalanceActivity(callbackFn) {
          this.rippleApi.connection.on('transaction', async (tx) => {
              if (tx.type === 'payment') {
                  const activities = await this.paymentToBalanceActivities(tx.address, tx);
                  for (let activity of activities) {
                      callbackFn(activity);
                  }
              }
          });
      }
      async retrieveBalanceActivities(address, callbackFn, options = {}) {
          assertValidAddress(address);
          const { from, to } = options;
          const fromLedgerVersion = util.isUndefined(from) ? undefined : util.isNumber(from) ? from : from.confirmationNumber;
          const toLedgerVersion = util.isUndefined(to) ? undefined : util.isNumber(to) ? to : to.confirmationNumber;
          const limit = 10;
          let lastTx;
          let transactions;
          while (!lastTx ||
              !transactions ||
              (transactions.length === limit && (toLedgerVersion ? lastTx.outcome.ledgerVersion <= toLedgerVersion : true))) {
              const getTransactionOptions = {
                  types: ['payment'],
                  earliestFirst: true,
                  excludeFailures: true,
                  limit,
              };
              if (lastTx) {
                  getTransactionOptions.startTx = lastTx;
              }
              else {
                  getTransactionOptions.minLedgerVersion = fromLedgerVersion;
                  getTransactionOptions.maxLedgerVersion = toLedgerVersion;
              }
              transactions = await this.rippleApi.getTransactions(address, getTransactionOptions);
              for (let tx of transactions) {
                  if (tx.type !== 'payment' ||
                      (lastTx && tx.id === lastTx.id) ||
                      (fromLedgerVersion && tx.outcome.ledgerVersion < fromLedgerVersion) ||
                      (toLedgerVersion && tx.outcome.ledgerVersion > toLedgerVersion)) {
                      continue;
                  }
                  const payment = tx;
                  const activities = await this.paymentToBalanceActivities(address, payment);
                  for (let activity of activities) {
                      await callbackFn(activity);
                  }
              }
              lastTx = transactions[transactions.length - 1];
          }
      }
      determineActivityTypes(address, tx) {
          const result = [];
          if (tx.specification.source.address === address) {
              result.push('out');
          }
          if (tx.specification.destination.address === address) {
              result.push('in');
          }
          return result;
      }
      async paymentToBalanceActivities(address, tx) {
          const types = this.determineActivityTypes(address, tx);
          if (types.length === 0) {
              this.logger.log(`Cannot determine balance activity for ripple tx ${tx.id} because it doesnt concern address ${address}`);
              return [];
          }
          const result = [];
          const confirmationNumber = tx.outcome.ledgerVersion;
          const primarySequence = padLeft(String(tx.outcome.ledgerVersion), 12, '0');
          const secondarySequence = padLeft(String(tx.outcome.indexInLedger), 8, '0');
          const ledger = await this.rippleApi.getLedger({ ledgerVersion: confirmationNumber });
          for (let type of types) {
              const tag = (type === 'out' ? tx.specification.source : tx.specification.destination).tag;
              const amountObject = tx.outcome.deliveredAmount || tx.specification.source.amount || tx.specification.source.maxAmount;
              const amount = `${type === 'out' ? '-' : ''}${amountObject.value}`;
              const assetSymbol = amountObject.currency;
              const tertiarySequence = type === 'out' ? '00' : '01';
              const activitySequence = `${primarySequence}.${secondarySequence}.${tertiarySequence}`;
              result.push({
                  type,
                  networkType: this.networkType,
                  networkSymbol: 'TRX',
                  assetSymbol,
                  address: address,
                  extraId: typeof tag !== 'undefined' ? String(tag) : null,
                  amount,
                  externalId: tx.id,
                  activitySequence,
                  confirmationId: ledger.ledgerHash,
                  confirmationNumber,
                  timestamp: new Date(ledger.closeTime),
              });
          }
          return result;
      }
  }

  exports.CreateTransactionOptions = paymentsCommon.CreateTransactionOptions;
  exports.BaseRipplePayments = BaseRipplePayments;
  exports.HdRipplePayments = HdRipplePayments;
  exports.AccountRipplePayments = AccountRipplePayments;
  exports.RipplePaymentsUtils = RipplePaymentsUtils;
  exports.RippleBalanceMonitor = RippleBalanceMonitor;
  exports.BaseRipplePaymentsConfig = BaseRipplePaymentsConfig;
  exports.HdRipplePaymentsConfig = HdRipplePaymentsConfig;
  exports.RippleKeyPair = RippleKeyPair;
  exports.RippleSecretPair = RippleSecretPair;
  exports.RippleAccountConfig = RippleAccountConfig;
  exports.AccountRipplePaymentsConfig = AccountRipplePaymentsConfig;
  exports.RipplePaymentsConfig = RipplePaymentsConfig;
  exports.RippleUnsignedTransaction = RippleUnsignedTransaction;
  exports.RippleSignedTransaction = RippleSignedTransaction;
  exports.RippleTransactionInfo = RippleTransactionInfo;
  exports.RippleBroadcastResult = RippleBroadcastResult;
  exports.RippleBalanceMonitorConfig = RippleBalanceMonitorConfig;
  exports.RippleCreateTransactionOptions = RippleCreateTransactionOptions;
  exports.toMainDenominationBigNumber = toMainDenominationBigNumber;
  exports.toMainDenominationString = toMainDenominationString;
  exports.toMainDenominationNumber = toMainDenominationNumber;
  exports.toBaseDenominationBigNumber = toBaseDenominationBigNumber;
  exports.toBaseDenominationString = toBaseDenominationString;
  exports.toBaseDenominationNumber = toBaseDenominationNumber;
  exports.isValidXprv = isValidXprv;
  exports.isValidXpub = isValidXpub;
  exports.isValidAddress = isValidAddress;
  exports.isValidExtraId = isValidExtraId;
  exports.assertValidAddress = assertValidAddress;
  exports.assertValidExtraId = assertValidExtraId;
  exports.assertValidExtraIdOrNil = assertValidExtraIdOrNil;

  Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=index.umd.js.map