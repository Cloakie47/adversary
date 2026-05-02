// Tempo payment flow helper.
// Handles: wallet → pathUSD transfer → backend verify → returns payment_token.
import { writeContract, waitForTransactionReceipt } from 'wagmi/actions';
import { parseUnits, encodeFunctionData } from 'viem';
import { wagmiConfig, tempoModerato } from './wagmi.js';
import { BACKEND_URL } from './debate.js';

// pathUSD has 6 decimals
const PATHUSD_DECIMALS = 6;
const PATHUSD_TOKEN = '0x20c0000000000000000000000000000000000000';

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

let _paymentInfoCache = null;

/**
 * Fetch backend payment info (treasury address, pricing, chain config).
 * Cached per session.
 */
export async function getPaymentInfo() {
  if (_paymentInfoCache) return _paymentInfoCache;
  const res = await fetch(`${BACKEND_URL}/payment-info`);
  if (!res.ok) throw new Error(`payment-info failed: ${res.status}`);
  _paymentInfoCache = await res.json();
  return _paymentInfoCache;
}

/**
 * Send a pathUSD payment from connected wallet to treasury.
 *
 * @param {string} toAddress - Treasury address (from getPaymentInfo)
 * @param {number} amountUsd - Amount in pathUSD (e.g. 1.0 or 0.1)
 * @returns {Promise<string>} Transaction hash
 */
export async function sendPayment(toAddress, amountUsd) {
  const amount = parseUnits(String(amountUsd), PATHUSD_DECIMALS);

  // wagmi v3 writeContract returns hash directly
  const hash = await writeContract(wagmiConfig, {
    address: PATHUSD_TOKEN,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [toAddress, amount],
    chainId: tempoModerato.id,
  });

  return hash;
}

/**
 * Wait for transaction receipt confirmation.
 *
 * @param {string} hash - Transaction hash
 * @returns {Promise<object>} Receipt
 */
export async function waitForPayment(hash) {
  return await waitForTransactionReceipt(wagmiConfig, {
    hash,
    chainId: tempoModerato.id,
  });
}

/**
 * Verify payment with backend, get back a single-use payment_token.
 *
 * @param {string} txHash
 * @param {'debate'|'translation'} action
 * @param {string|null} resourceId - For translations: the attack_id. For debates: null.
 * @returns {Promise<{payment_token, payer, amount_usd, expires_in}>}
 */
export async function verifyPayment(txHash, action, resourceId = null) {
  const res = await fetch(`${BACKEND_URL}/pay-and-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_hash: txHash,
      action,
      resource_id: resourceId,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    let msg = errBody;
    try {
      const parsed = JSON.parse(errBody);
      msg = parsed.detail || msg;
    } catch (_) {}
    throw new Error(`Verification failed (${res.status}): ${msg}`);
  }
  return await res.json();
}

/**
 * Full flow: send tx → wait for confirmation → verify with backend → return token.
 *
 * Status callback receives: 'sending' | 'waiting' | 'verifying' | 'done' | 'error'
 *
 * @returns {Promise<{paymentToken, txHash, payer, amountUsd, explorerUrl}>}
 */
export async function payAndVerify({ amountUsd, action, resourceId = null, onStatus }) {
  const info = await getPaymentInfo();
  const treasuryAddress = info.treasury_address;
  if (!treasuryAddress) throw new Error('Treasury address not configured');

  // 1. User signs + broadcasts
  if (onStatus) onStatus('sending');
  const txHash = await sendPayment(treasuryAddress, amountUsd);

  // 2. Wait for chain confirmation
  if (onStatus) onStatus('waiting');
  await waitForPayment(txHash);

  // 3. Verify with backend, mint single-use token
  if (onStatus) onStatus('verifying');
  const result = await verifyPayment(txHash, action, resourceId);

  if (onStatus) onStatus('done');

  return {
    paymentToken: result.payment_token,
    txHash,
    payer: result.payer,
    amountUsd: result.amount_usd,
    explorerUrl: `https://explore.moderato.tempo.xyz/tx/${txHash}`,
  };
}
