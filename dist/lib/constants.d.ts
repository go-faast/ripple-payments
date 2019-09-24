import { NetworkType } from '@faast/payments-common';
import { RippleCreateTransactionOptions } from './types';
export declare const PACKAGE_NAME = "ripple-payments";
export declare const DECIMAL_PLACES = 6;
export declare const MIN_BALANCE = 20;
export declare const DEFAULT_CREATE_TRANSACTION_OPTIONS: RippleCreateTransactionOptions;
export declare const DEFAULT_MAX_LEDGER_VERSION_OFFSET = 100;
export declare const ADDRESS_REGEX: RegExp;
export declare const EXTRA_ID_REGEX: RegExp;
export declare const XPUB_REGEX: RegExp;
export declare const XPRV_REGEX: RegExp;
export declare const NOT_FOUND_ERRORS: string[];
export declare const DEFAULT_NETWORK = NetworkType.Mainnet;
export declare const DEFAULT_MAINNET_SERVER = "wss://s1.ripple.com";
export declare const DEFAULT_TESTNET_SERVER = "wss://s.altnet.rippletest.net:51233";
