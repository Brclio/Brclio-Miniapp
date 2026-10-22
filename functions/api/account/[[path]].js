import { proxyAccount } from '../../../web/account-proxy.mjs';

export function onRequest(context) { return proxyAccount(context.request, context.env); }
